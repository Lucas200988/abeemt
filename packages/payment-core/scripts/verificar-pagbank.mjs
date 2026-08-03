#!/usr/bin/env node
/**
 * Verificação do adapter do PagBank contra o SANDBOX real.
 *
 * Roda na máquina do operador (o ambiente de desenvolvimento remoto não
 * alcança os servidores do PagBank). Exercita, na ordem, o modelo inteiro do
 * produto: reservar → cobrar MENOS que o reservado → devolver → cancelar →
 * recusa. Cada passo imprime ✅ ou ❌, e a saída completa é o que se cola de
 * volta no chat para decidir a virada de BORA_PAGBANK_VERIFIED.
 *
 * Diferença em relação à verificação da Rede: o PagBank exige o cartão
 * CRIPTOGRAFADO com a chave pública da conta, e quem gera o blob é o
 * "gerador de criptografia" do portal de sandbox (portaldev.pagbank.com.br
 * → Cartões teste). O script imprime a chave pública e as instruções; os
 * dois blobs (cartão aprovado e cartão recusado) entram pelo .env.
 *
 * Os cartões usados são os FICTÍCIOS publicados pelo próprio portal. Não são
 * dados de portador real: não existe portador.
 *
 * Uso:  pnpm verificar:pagbank   (na raiz do projeto)
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARTOES_DE_TESTE_SANDBOX, CONTRATO, PagBankProvider } from '../dist/index.js';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = resolve(aqui, '../../..');

// ---------------------------------------------------------------------------
// Configuração — lida do .env da raiz, sem depender de nada instalado
// ---------------------------------------------------------------------------

function lerEnv() {
  let texto;
  try {
    texto = readFileSync(resolve(raiz, '.env'), 'utf8');
  } catch {
    return {};
  }

  const valores = {};
  for (const linha of texto.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(linha);
    if (m && !linha.trim().startsWith('#')) valores[m[1]] = m[2];
  }
  return valores;
}

const env = lerEnv();
const token = env.BORA_PAGBANK_SANDBOX_TOKEN;

if (!token) {
  console.log('');
  console.log('❌ Falta o token de sandbox do PagBank no arquivo .env da raiz do projeto.');
  console.log('');
  console.log('   1. Entre em portaldev.pagbank.com.br e clique em "Tokens".');
  console.log('   2. Copie o token de teste.');
  console.log('   3. Abra o .env no Bloco de Notas e acrescente, no final:');
  console.log('');
  console.log('   BORA_PAGBANK_SANDBOX_TOKEN=<o token copiado>');
  console.log('');
  console.log('   Depois rode este comando de novo:  pnpm verificar:pagbank');
  process.exit(1);
}

const baseUrl = env.BORA_PAGBANK_BASE_URL || CONTRATO.baseUrlSandbox.valor;
const blobAprovado = env.BORA_PAGBANK_CARTAO_APROVADO_CRIPTO;
const blobRecusado = env.BORA_PAGBANK_CARTAO_RECUSADO_CRIPTO;

// CPF de exemplo da própria documentação do PagBank. Não é de ninguém.
const CPF_TESTE = '12345678909';
const PORTADOR = 'Teste Bora Carregar';

// ---------------------------------------------------------------------------
// Apoio
// ---------------------------------------------------------------------------

const resultados = [];

function registrar(ok, titulo, detalhe = '') {
  resultados.push({ ok, titulo });
  console.log(`${ok ? '✅' : '❌'} ${titulo}${detalhe ? ` — ${detalhe}` : ''}`);
}

/** Limpa qualquer credencial de um texto antes de imprimir. */
function limpo(texto) {
  return String(texto).split(token).join('[TOKEN]');
}

/** Descreve um erro mostrando o que o PagBank respondeu, não só o HTTP. */
function detalheDoErro(e) {
  const corpo = e?.raw ? ` · resposta: ${JSON.stringify(e.raw).slice(0, 300)}` : '';
  return limpo(`${e?.message ?? e}${corpo}`);
}

function chaveIdempotencia() {
  return `verif-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// O roteiro
// ---------------------------------------------------------------------------

console.log('');
console.log('Verificação do adapter do PagBank contra o sandbox');
console.log(`Endereço: ${baseUrl}`);
console.log('==================================================');
console.log('');

const adapter = new PagBankProvider({
  baseUrl,
  token,
  // `true` AQUI, e só aqui: este script É a verificação. O .env continua
  // com BORA_PAGBANK_VERIFIED=false até esta saída ser aprovada.
  verificado: true,
});

// 1. Chave pública — sem ela o gerador do portal não produz o blob.
//
// Feita com fetch direto (não pelo adapter) para poder mostrar o código HTTP
// e o corpo cru de cada tentativa: quando o PagBank recusa, o MOTIVO está aí.
async function chamarChavePublica(metodo) {
  const caminho = metodo === 'GET' ? '/public-keys/card' : '/public-keys';
  const resposta = await fetch(`${baseUrl.replace(/\/+$/, '')}${caminho}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: metodo === 'GET' ? undefined : JSON.stringify({ type: 'card' }),
  });
  const texto = await resposta.text().catch(() => '');
  let corpo = {};
  try {
    corpo = JSON.parse(texto);
  } catch {
    /* resposta não-JSON: fica no texto cru */
  }
  return { http: resposta.status, corpo, texto };
}

let chavePublica = null;
try {
  const busca = await chamarChavePublica('GET');
  if (busca.corpo.public_key) {
    chavePublica = busca.corpo.public_key;
    registrar(true, '1. Chave pública de cartão da conta', `${chavePublica.slice(0, 24)}…`);
  } else {
    // Conta nova pode não ter chave ainda: cria e tenta de novo.
    const criacao = await chamarChavePublica('POST');
    if (criacao.corpo.public_key) {
      chavePublica = criacao.corpo.public_key;
      registrar(true, '1. Chave pública de cartão (criada agora)', `${chavePublica.slice(0, 24)}…`);
    } else {
      registrar(
        false,
        '1. Chave pública de cartão',
        limpo(
          `GET HTTP ${busca.http} · ${busca.texto.slice(0, 200) || '(corpo vazio)'} | ` +
            `POST HTTP ${criacao.http} · ${criacao.texto.slice(0, 200) || '(corpo vazio)'}`,
        ),
      );
      if (busca.http === 401 || criacao.http === 401) {
        console.log('');
        console.log('   HTTP 401 = o PagBank não reconheceu o token. Confira no .env:');
        console.log('   - o token é o da página "Tokens" do portaldev.pagbank.com.br;');
        console.log('   - foi colado inteiro, numa linha só, sem espaços nem quebras;');
        console.log('   - se você gerou um token novo no portal, o antigo deixa de valer.');
      } else if (busca.http === 403 || criacao.http === 403) {
        console.log('');
        console.log('   HTTP 403 = o token existe mas não tem permissão para chaves públicas.');
        console.log('   Me mande esta saída, que eu investigo o caminho certo.');
      }
    }
  }
} catch (e) {
  registrar(false, '1. Chave pública de cartão', detalheDoErro(e));
}

// Sem os blobs, o roteiro para aqui — com as instruções de como gerá-los.
if (!blobAprovado || !blobRecusado) {
  const aprovado = CARTOES_DE_TESTE_SANDBOX.aprovados[0];
  const recusado = CARTOES_DE_TESTE_SANDBOX.recusados[0];
  console.log('');
  console.log('⏸  Faltam os cartões criptografados. Como gerar (5 minutos):');
  console.log('');
  console.log('   1. Entre em portaldev.pagbank.com.br → "Cartões teste".');
  console.log('   2. Desça até "Criptografe seu cartão".');
  if (chavePublica) {
    console.log('   3. No campo da chave pública, cole ESTA chave (copie da linha abaixo):');
    console.log('');
    console.log(`   ${chavePublica}`);
    console.log('');
  } else {
    console.log('   3. No campo da chave pública, cole a chave da sua conta (passo 1 falhou —');
    console.log('      me mande a saída para eu ver o motivo).');
  }
  console.log(`   4. Preencha com o cartão APROVADO: número ${aprovado.numero} (${aprovado.bandeira}),`);
  console.log(`      nome ${PORTADOR}, CVV ${CARTOES_DE_TESTE_SANDBOX.cvv}, expiração 12/2030.`);
  console.log('      Copie o "Resultado".');
  console.log('   5. Repita com o cartão RECUSADO: número ' + recusado.numero + '.');
  console.log('   6. Abra o .env no Bloco de Notas e acrescente as duas linhas:');
  console.log('');
  console.log('   BORA_PAGBANK_CARTAO_APROVADO_CRIPTO=<resultado do passo 4>');
  console.log('   BORA_PAGBANK_CARTAO_RECUSADO_CRIPTO=<resultado do passo 5>');
  console.log('');
  console.log('   Depois rode de novo:  pnpm verificar:pagbank');
  console.log('');
  process.exit(resultados.every((r) => r.ok) ? 0 : 1);
}

const metadataAprovado = {
  encryptedCard: blobAprovado,
  customerTaxId: CPF_TESTE,
  holderName: PORTADOR,
};

try {
  // 2. Pré-autorização de R$ 200,00
  let chargeId = null;
  {
    const r = await adapter.authorize({
      amountCents: 20000,
      method: 'CREDIT_CARD',
      idempotencyKey: chaveIdempotencia(),
      description: 'Bora Carregar verificacao',
      metadata: metadataAprovado,
    });
    chargeId = r.providerPaymentId || null;
    const ok = r.status === 'AUTHORIZED' && Boolean(chargeId);
    registrar(
      ok,
      '2. Reserva de R$ 200,00 (capture:false)',
      ok ? `cobrança ${chargeId}` : limpo(`status ${r.status} · ${JSON.stringify(r.raw).slice(0, 300)}`),
    );
    if (!ok) throw new Error('sem reserva não há o que capturar');
  }

  // Daqui em diante, um passo que falhe NÃO derruba os seguintes.

  // 3. O adapter enxerga a reserva
  try {
    const r = await adapter.getPayment(chargeId);
    registrar(
      r.status === 'AUTHORIZED',
      '3. Consulta pelo adapter mostra a reserva em pé',
      `status ${r.status}, autorizado ${r.amountAuthorizedCents}`,
    );
  } catch (e) {
    registrar(false, '3. Consulta pelo adapter mostra a reserva em pé', detalheDoErro(e));
  }

  // 4. Captura de R$ 8,00 — MENOS que o reservado. É o produto inteiro.
  try {
    const r = await adapter.capture(chargeId, 800);
    registrar(
      r.status === 'CAPTURED' && r.amountCapturedCents === 800,
      '4. Captura PARCIAL de R$ 8,00 sobre R$ 200,00 reservados',
      `status ${r.status}, capturado ${r.amountCapturedCents}`,
    );
  } catch (e) {
    registrar(false, '4. Captura PARCIAL de R$ 8,00 sobre R$ 200,00 reservados', detalheDoErro(e));
  }

  // 5. A consulta confirma a captura
  try {
    const r = await adapter.getPayment(chargeId);
    registrar(
      r.status === 'CAPTURED' && r.amountCapturedCents === 800,
      '5. Consulta confirma R$ 8,00 cobrados',
      `status ${r.status}, capturado ${r.amountCapturedCents}, devolvido ${r.amountRefundedCents}`,
    );
  } catch (e) {
    registrar(false, '5. Consulta confirma R$ 8,00 cobrados', detalheDoErro(e));
  }

  // 6. Devolução do valor cobrado — sem informar o valor, para exercitar a
  // descoberta pela consulta (a lição da rodada 1 da Rede).
  try {
    const r = await adapter.refund(chargeId);
    registrar(
      r.status === 'REFUNDED' && r.amountRefundedCents === 800,
      '6. Devolução dos R$ 8,00 (valor descoberto na consulta)',
      `status ${r.status}, devolvido ${r.amountRefundedCents}`,
    );
  } catch (e) {
    registrar(false, '6. Devolução dos R$ 8,00 (valor descoberto na consulta)', detalheDoErro(e));
  }

  // 7. Nova reserva e cancelamento SEM captura (o caso "recarga não aconteceu")
  try {
    const r2 = await adapter.authorize({
      amountCents: 5000,
      method: 'CREDIT_CARD',
      idempotencyKey: chaveIdempotencia(),
      description: 'Bora Carregar cancelamento',
      metadata: metadataAprovado,
    });
    if (r2.status === 'AUTHORIZED' && r2.providerPaymentId) {
      const r = await adapter.voidPayment(r2.providerPaymentId);
      registrar(
        r.status === 'VOIDED',
        '7. Reserva de R$ 50,00 cancelada sem cobrar nada',
        `status ${r.status}, capturado ${r.amountCapturedCents}`,
      );
    } else {
      registrar(
        false,
        '7. Reserva para o teste de cancelamento',
        limpo(`status ${r2.status} · ${JSON.stringify(r2.raw).slice(0, 200)}`),
      );
    }
  } catch (e) {
    registrar(false, '7. Reserva de R$ 50,00 cancelada sem cobrar nada', detalheDoErro(e));
  }

  // 8. Recusa do emissor — com o cartão da aba "Negada".
  try {
    const r = await adapter.authorize({
      amountCents: 1000,
      method: 'CREDIT_CARD',
      idempotencyKey: chaveIdempotencia(),
      description: 'Bora Carregar recusa',
      metadata: { ...metadataAprovado, encryptedCard: blobRecusado },
    });
    const recusada = r.status === 'DECLINED' || !r.ok;
    registrar(
      recusada,
      '8. Recusa do emissor é tratada como recusa',
      `status ${r.status}, código ${r.providerCode ?? '—'}`,
    );
  } catch (e) {
    // Recusa também pode vir como HTTP 4xx com o motivo no corpo — vale igual.
    const raw = JSON.stringify(e?.raw ?? {});
    const recusada = /DECLINED|error_messages/i.test(raw);
    registrar(
      recusada,
      '8. Recusa do emissor é tratada como recusa',
      recusada ? limpo(raw.slice(0, 200)) : detalheDoErro(e),
    );
  }
} catch (e) {
  console.log('');
  console.log(`Interrompido: ${detalheDoErro(e)}`);
}

// ---------------------------------------------------------------------------
// Veredicto
// ---------------------------------------------------------------------------

const total = resultados.length;
const ok = resultados.filter((r) => r.ok).length;

console.log('');
console.log('==================================================');
console.log(`Resultado: ${ok} de ${total} passos aprovados`);
console.log('');
if (ok === total && total >= 8) {
  console.log('Tudo passou. COPIE TODA ESTA SAÍDA e cole no chat — a decisão de');
  console.log('ligar BORA_PAGBANK_VERIFIED=true é tomada lá, com esta evidência.');
} else {
  console.log('Nem tudo passou. COPIE TODA ESTA SAÍDA e cole no chat, que eu');
  console.log('analiso o que o PagBank respondeu. NÃO mude BORA_PAGBANK_VERIFIED.');
}
console.log('');
