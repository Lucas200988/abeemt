#!/usr/bin/env node
/**
 * Verificação do adapter da Rede contra o SANDBOX real.
 *
 * Roda na máquina do operador (o ambiente de desenvolvimento remoto não
 * alcança os servidores da Rede). Exercita, na ordem, o modelo inteiro do
 * produto: reservar → cobrar MENOS que o reservado → devolver → cancelar →
 * recusa. Cada passo imprime ✅ ou ❌, e a saída completa é o que se cola de
 * volta no chat para decidir a virada de BORA_REDE_VERIFIED.
 *
 * O cartão usado é o de TESTE público da Rede (manual v1.38, §Sandbox
 * Tutorial > Cards). Não é dado de portador real: não existe portador. A
 * chamada de autorização é feita direto pelo script justamente porque o
 * adapter se recusa a tocar em número de cartão — regra que continua valendo
 * em produção, onde o número nasce e morre no equipamento da Rede.
 *
 * Uso:  pnpm verificar:rede   (na raiz do projeto)
 */

import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTRATO_REDE, RedeProvider } from '../dist/index.js';

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
const pv = env.BORA_REDE_PV;
const chave = env.BORA_REDE_INTEGRATION_KEY;

if (!pv || !chave) {
  console.log('');
  console.log('❌ Faltam as credenciais da Rede no arquivo .env da raiz do projeto.');
  console.log('');
  console.log('   Abra o .env no Bloco de Notas e acrescente, no final:');
  console.log('');
  console.log('   BORA_REDE_PV=<o PV (clientId) do card do projeto>');
  console.log('   BORA_REDE_INTEGRATION_KEY=<o Token (clientSecret) do card>');
  console.log('');
  console.log('   Depois rode este comando de novo:  pnpm verificar:rede');
  process.exit(1);
}

const baseUrl = env.BORA_REDE_BASE_URL || CONTRATO_REDE.baseUrlSandbox.valor;
const oauthUrl = env.BORA_REDE_OAUTH_URL || CONTRATO_REDE.oauthUrlSandbox.valor;

// Cartão de TESTE público da Rede (manual v1.38). Não existe portador real.
const CARTAO_TESTE = {
  cardholderName: 'Teste Bora Carregar',
  cardNumber: '5448280000000007',
  expirationMonth: 1,
  expirationYear: 2035,
  securityCode: '123',
};

// ---------------------------------------------------------------------------
// Apoio
// ---------------------------------------------------------------------------

const resultados = [];

function registrar(ok, titulo, detalhe = '') {
  resultados.push({ ok, titulo });
  console.log(`${ok ? '✅' : '❌'} ${titulo}${detalhe ? ` — ${detalhe}` : ''}`);
}

function referencia() {
  return randomBytes(8).toString('hex'); // 16 caracteres, limite da Rede
}

let tokenOauth = null;

async function obterToken() {
  const basic = Buffer.from(`${pv.replace(/^0+/, '')}:${chave}`).toString('base64');
  const resposta = await fetch(`${oauthUrl.replace(/\/+$/, '')}/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok || !corpo.access_token) {
    throw new Error(`autenticação falhou (HTTP ${resposta.status}): ${JSON.stringify(corpo)}`);
  }
  tokenOauth = corpo.access_token;
  return corpo;
}

/** Autorização direta com o cartão de teste — fora do adapter, de propósito. */
async function autorizarDireto(amountCents) {
  const resposta = await fetch(`${baseUrl.replace(/\/+$/, '')}/v2/transactions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenOauth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      capture: false,
      kind: 'credit',
      reference: referencia(),
      amount: amountCents,
      ...CARTAO_TESTE,
    }),
  });

  return { http: resposta.status, corpo: await resposta.json().catch(() => ({})) };
}

/** Limpa qualquer credencial de um texto antes de imprimir. */
function limpo(texto) {
  let t = String(texto);
  t = t.split(chave).join('[CHAVE]');
  if (tokenOauth) t = t.split(tokenOauth).join('[TOKEN]');
  return t;
}

/** Descreve um erro mostrando o que a Rede respondeu, não só o HTTP. */
function detalheDoErro(e) {
  const corpo = e?.raw ? ` · resposta: ${JSON.stringify(e.raw).slice(0, 300)}` : '';
  return limpo(`${e?.message ?? e}${corpo}`);
}

// ---------------------------------------------------------------------------
// O roteiro
// ---------------------------------------------------------------------------

console.log('');
console.log('Verificação do adapter da Rede contra o sandbox');
console.log(`Endereço: ${baseUrl}`);
console.log('================================================');
console.log('');

const adapter = new RedeProvider({
  pv,
  integrationKey: chave,
  baseUrl,
  oauthUrl,
  // `true` AQUI, e só aqui: este script É a verificação. O .env continua
  // com BORA_REDE_VERIFIED=false até esta saída ser aprovada.
  verificado: true,
});

try {
  // 1. OAuth
  try {
    const t = await obterToken();
    registrar(true, '1. Autenticação OAuth 2.0', `token de ${t.expires_in ?? '?'} s`);
  } catch (e) {
    registrar(false, '1. Autenticação OAuth 2.0', limpo(e.message));
    throw new Error('sem token não há como continuar');
  }

  // 2. Pré-autorização de R$ 200,00
  let tid = null;
  {
    const { http, corpo } = await autorizarDireto(20000);
    tid = corpo?.tid ?? null;
    const ok = corpo?.returnCode === '00' && Boolean(tid);
    registrar(
      ok,
      '2. Reserva de R$ 200,00 (capture:false)',
      ok ? `tid ${tid}` : limpo(`HTTP ${http} · ${JSON.stringify(corpo).slice(0, 300)}`),
    );
    if (!ok) throw new Error('sem reserva não há o que capturar');
  }

  // Daqui em diante, um passo que falhe NÃO derruba os seguintes: cada um
  // registra o próprio ❌ com a resposta da Rede, e o roteiro segue.

  // 3. O adapter enxerga a reserva
  try {
    const r = await adapter.getPayment(tid);
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
    const r = await adapter.capture(tid, 800);
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
    const r = await adapter.getPayment(tid);
    registrar(
      r.status === 'CAPTURED' && r.amountCapturedCents === 800,
      '5. Consulta confirma R$ 8,00 cobrados',
      `status ${r.status}, capturado ${r.amountCapturedCents}, devolvido ${r.amountRefundedCents}`,
    );
  } catch (e) {
    registrar(false, '5. Consulta confirma R$ 8,00 cobrados', detalheDoErro(e));
  }

  // 6. Devolução do valor cobrado
  try {
    const r = await adapter.refund(tid, 800);
    const ok = r.status === 'REFUNDED' || r.providerCode === '360' || r.providerCode === '359';
    registrar(
      ok,
      '6. Devolução dos R$ 8,00',
      `status ${r.status}, código ${r.providerCode ?? '—'} (360 = processa em D+1, é normal)`,
    );
  } catch (e) {
    registrar(false, '6. Devolução dos R$ 8,00', detalheDoErro(e));
  }

  // 7. Nova reserva e cancelamento SEM captura (o caso "recarga não aconteceu")
  try {
    const { corpo } = await autorizarDireto(5000);
    const tid2 = corpo?.tid;
    if (corpo?.returnCode === '00' && tid2) {
      const r = await adapter.voidPayment(tid2);
      const ok = r.status === 'VOIDED' || r.providerCode === '360' || r.providerCode === '359';
      registrar(
        ok,
        '7. Reserva de R$ 50,00 cancelada sem cobrar nada',
        `status ${r.status}, código ${r.providerCode ?? '—'}`,
      );
    } else {
      registrar(false, '7. Reserva para o teste de cancelamento', limpo(JSON.stringify(corpo).slice(0, 200)));
    }
  } catch (e) {
    registrar(false, '7. Reserva de R$ 50,00 cancelada sem cobrar nada', detalheDoErro(e));
  }

  // 8. Recusa do emissor (valor 111 força "Insufficient funds" no sandbox)
  try {
    const { corpo } = await autorizarDireto(111);
    const recusada = corpo?.returnCode && corpo.returnCode !== '00';
    registrar(
      Boolean(recusada),
      '8. Recusa do emissor é tratada como recusa',
      `código ${corpo?.returnCode ?? '?'} · ${corpo?.returnMessage ?? ''}`,
    );
  } catch (e) {
    // Recusa costuma vir como HTTP 400 com o código no corpo — também vale.
    const corpo = e?.raw;
    const recusada = corpo && typeof corpo.returnCode === 'string' && corpo.returnCode !== '00';
    registrar(
      Boolean(recusada),
      '8. Recusa do emissor é tratada como recusa',
      recusada ? `código ${corpo.returnCode} · ${corpo.returnMessage ?? ''}` : detalheDoErro(e),
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
console.log('================================================');
console.log(`Resultado: ${ok} de ${total} passos aprovados`);
console.log('');
if (ok === total && total >= 8) {
  console.log('Tudo passou. COPIE TODA ESTA SAÍDA e cole no chat — a decisão de');
  console.log('ligar BORA_REDE_VERIFIED=true é tomada lá, com esta evidência.');
} else {
  console.log('Nem tudo passou. COPIE TODA ESTA SAÍDA e cole no chat, que eu');
  console.log('analiso o que a Rede respondeu. NÃO mude BORA_REDE_VERIFIED.');
}
console.log('');
