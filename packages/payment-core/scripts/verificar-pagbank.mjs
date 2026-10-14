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

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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

// ---------------------------------------------------------------------------
// Ambiente: sandbox (padrão) ou PRODUÇÃO
//
// A homologação do PagBank foi aprovada em 2026-08-04 (chamado 1424039934) e
// o time de integração pede UM teste em produção com os logs das requisições.
// O modo produção usa valores simbólicos, pula o teste de recusa (não existe
// cartão de recusa em produção — a recusa foi provada no sandbox) e grava os
// logs sanitizados num arquivo para enviar ao PagBank.
// ---------------------------------------------------------------------------

const ambiente = (env.BORA_PAGBANK_AMBIENTE || 'sandbox').toLowerCase();
const producao = ambiente === 'producao';
const token = producao ? env.BORA_PAGBANK_PROD_TOKEN : env.BORA_PAGBANK_SANDBOX_TOKEN;

if (!token) {
  console.log('');
  if (producao) {
    console.log('❌ Falta o token de PRODUÇÃO do PagBank no arquivo .env.');
    console.log('');
    console.log('   Como gerar (instrução do próprio PagBank no chamado):');
    console.log('   1. Acesse o iBanking (conta PagBank).');
    console.log('   2. Vá em Vendas > Plataformas e Checkout > Integrações.');
    console.log('   3. Gere o token de produção e acrescente no .env:');
    console.log('');
    console.log('   BORA_PAGBANK_PROD_TOKEN=<o token de produção>');
  } else {
    console.log('❌ Falta o token de sandbox do PagBank no arquivo .env da raiz do projeto.');
    console.log('');
    console.log('   1. Entre em portaldev.pagbank.com.br e clique em "Tokens".');
    console.log('   2. Copie o token de teste.');
    console.log('   3. Abra o .env no Bloco de Notas e acrescente, no final:');
    console.log('');
    console.log('   BORA_PAGBANK_SANDBOX_TOKEN=<o token copiado>');
  }
  console.log('');
  console.log('   Depois rode este comando de novo:  pnpm verificar:pagbank');
  process.exit(1);
}

if (producao && env.BORA_PAGBANK_PRODUCAO_CONFIRMO !== 'sim') {
  console.log('');
  console.log('⚠️  MODO PRODUÇÃO: as transações movem DINHEIRO DE VERDADE no SEU cartão.');
  console.log('');
  console.log('   O roteiro usa valores simbólicos e devolve tudo ao final:');
  console.log('   reserva de R$ 5,00 → captura de R$ 1,00 → devolução de R$ 1,00;');
  console.log('   reserva de R$ 2,00 → cancelamento integral.');
  console.log('   Custo esperado ao final: R$ 0,00 (fora eventual demora de estorno');
  console.log('   na fatura, que é do emissor do cartão).');
  console.log('');
  console.log('   Para confirmar que entendeu e prosseguir, acrescente no .env:');
  console.log('');
  console.log('   BORA_PAGBANK_PRODUCAO_CONFIRMO=sim');
  process.exit(1);
}

if (producao && !/^\d{11}$/.test(env.BORA_PAGBANK_CPF || '')) {
  console.log('');
  console.log('❌ Em produção o CPF do comprador precisa ser REAL (o seu), porque o');
  console.log('   antifraude valida. Acrescente no .env (só números):');
  console.log('');
  console.log('   BORA_PAGBANK_CPF=<seu CPF, 11 dígitos>');
  console.log('   BORA_PAGBANK_PORTADOR=<seu nome como está no cartão>');
  process.exit(1);
}

const baseUrl =
  env.BORA_PAGBANK_BASE_URL ||
  (producao ? CONTRATO.baseUrlProducao.valor : CONTRATO.baseUrlSandbox.valor);

// Valores do roteiro: simbólicos em produção, os de sempre no sandbox.
const VALOR_RESERVA = producao ? 500 : 20000;
const VALOR_CAPTURA = producao ? 100 : 800;
const VALOR_RESERVA_2 = producao ? 200 : 5000;
const reais = (c) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;
// O criptograma é de USO ÚNICO (erro 40002 ao reusar): cada autorização gasta
// um blob. O roteiro faz DUAS autorizações aprovadas (passos 2 e 7), então
// precisa de dois blobs do cartão aprovado.
//
// O teste de recusa (passo 8) NÃO usa blob: o simulador do sandbox aprovou o
// cartão da aba "Negada" até em cobrança direta quando veio criptografado
// (rodada de 2026-08-03) — ele só reage ao número em claro, então o passo 8
// envia o cartão fictício direto, como o roteiro da Rede faz.
const blobAprovado = env.BORA_PAGBANK_CARTAO_APROVADO_CRIPTO;
const blobAprovado2 = env.BORA_PAGBANK_CARTAO_APROVADO_CRIPTO_2;

// CPF de exemplo da própria documentação do PagBank (sandbox). Em produção o
// antifraude valida, então o CPF e o nome vêm do .env — são os do dono do
// cartão real usado no teste.
const CPF_TESTE = producao ? env.BORA_PAGBANK_CPF : env.BORA_PAGBANK_CPF || '12345678909';
const PORTADOR =
  env.BORA_PAGBANK_PORTADOR || (producao ? 'PORTADOR NAO INFORMADO' : 'Teste Bora Carregar');
const EMAIL_COMPRADOR = env.BORA_PAGBANK_EMAIL || 'teste@sonare.com.br';

// ---------------------------------------------------------------------------
// Logs para o PagBank: o time de integração pede os logs das requisições do
// teste em produção. Todo tráfego passa por este fetch instrumentado, que
// grava método, URL, corpo e resposta — com o token e o criptograma REDIGIDOS.
// ---------------------------------------------------------------------------

const logsRequisicoes = [];

function sanitizarCorpo(texto) {
  if (!texto) return texto;
  let t = String(texto);
  t = t.split(token).join('[TOKEN-REDIGIDO]');
  t = t.replace(/"encrypted"\s*:\s*"[^"]+"/g, '"encrypted":"[CRIPTOGRAMA-REDIGIDO]"');
  return t;
}

const fetchInstrumentado = async (url, init = {}) => {
  const inicio = new Date().toISOString();
  const resposta = await fetch(url, init);
  const textoResposta = await resposta.clone().text().catch(() => '');
  logsRequisicoes.push({
    quando: inicio,
    metodo: init.method || 'GET',
    url: String(url),
    cabecalhos: {
      ...Object.fromEntries(
        Object.entries(init.headers || {}).map(([k, v]) => [
          k,
          k.toLowerCase() === 'authorization' ? 'Bearer [TOKEN-REDIGIDO]' : v,
        ]),
      ),
    },
    corpoEnviado: sanitizarCorpo(init.body),
    httpStatus: resposta.status,
    corpoRecebido: sanitizarCorpo(textoResposta).slice(0, 4000),
  });
  return resposta;
};

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
console.log(
  producao
    ? '⚠️  Verificação do adapter do PagBank contra a PRODUÇÃO (dinheiro real)'
    : 'Verificação do adapter do PagBank contra o sandbox',
);
console.log(`Endereço: ${baseUrl}`);
// Raio-X do token SEM expor o token: tamanho e pontas. Serve para comparar
// com o que o portal mostra — token cortado ou com quebra de linha dá 401.
console.log(
  `Token do .env: ${token.length} caracteres, começa com "${token.slice(0, 4)}", ` +
    `termina com "${token.slice(-4)}"`,
);
if (/\s/.test(token)) {
  console.log('⚠️  O token contém espaço ou quebra de linha no meio — isso derruba a');
  console.log('   autenticação. Refaça a linha no .env deixando tudo colado.');
}
console.log('==================================================');
console.log('');

const adapter = new PagBankProvider({
  baseUrl,
  token,
  fetchImpl: fetchInstrumentado,
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
  const resposta = await fetchInstrumentado(`${baseUrl.replace(/\/+$/, '')}${caminho}`, {
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
if (!blobAprovado || !blobAprovado2) {
  const aprovado = CARTOES_DE_TESTE_SANDBOX.aprovados[0];
  console.log('');
  console.log('⏸  Faltam os cartões criptografados. Como gerar (5 minutos):');
  console.log('');
  if (producao) {
    console.log('   ⚠️  PRODUÇÃO: use o SEU cartão de crédito REAL, e a chave pública de');
    console.log('   PRODUÇÃO impressa acima (gerada em api.pagseguro.com/public-keys).');
    console.log('');
    console.log('   O gerador do portal de sandbox RECUSA a chave de produção. Use a');
    console.log('   página local com o SDK oficial do PagBank:');
    console.log('');
    console.log('   1. Abra no navegador (duplo clique) o arquivo:');
    console.log('      packages\\payment-core\\scripts\\criptografar-cartao.html');
    console.log('   2. A criptografia roda no SEU navegador com o código oficial do');
    console.log('      PagBank; o número do cartão não sai da página.');
    if (chavePublica) {
      console.log('   3. No campo da chave pública, cole ESTA chave de PRODUÇÃO (copie a');
      console.log('      linha inteira abaixo):');
      console.log('');
      console.log(`   ${chavePublica}`);
      console.log('');
    } else {
      console.log('   3. O passo 1 falhou e a chave de produção não veio — me mande a saída.');
    }
    console.log('   4. Preencha com o SEU cartão real (número, nome como está no cartão,');
    console.log('      CVV e validade) e copie o "Resultado".');
    console.log('   5. Gere DE NOVO com os mesmos dados, mudando só o nome (ex.: acrescente');
    console.log('      um "B" no final) e copie o segundo resultado.');
    console.log('   6. Acrescente no .env, substituindo os valores antigos:');
    console.log('');
    console.log('   BORA_PAGBANK_CARTAO_APROVADO_CRIPTO=<resultado do passo 4>');
    console.log('   BORA_PAGBANK_CARTAO_APROVADO_CRIPTO_2=<resultado do passo 5>');
    console.log('');
    console.log('   Depois rode de novo:  pnpm verificar:pagbank');
    console.log('');
    process.exit(resultados.every((r) => r.ok) ? 0 : 1);
  }
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
  console.log(`      nome "Bora Um", CVV ${CARTOES_DE_TESTE_SANDBOX.cvv}, expiração 12/2030.`);
  console.log('      Copie o "Resultado".');
  console.log('   5. Gere DE NOVO com o MESMO cartão, mudando o nome para "Bora Dois", e');
  console.log('      copie o segundo resultado. (cada criptograma só vale UMA autorização,');
  console.log('      e dados iguais geram o mesmo criptograma — por isso o nome muda)');
  console.log('   6. Abra o .env no Bloco de Notas e acrescente as duas linhas:');
  console.log('');
  console.log('   BORA_PAGBANK_CARTAO_APROVADO_CRIPTO=<resultado do passo 4>');
  console.log('   BORA_PAGBANK_CARTAO_APROVADO_CRIPTO_2=<resultado do passo 5>');
  console.log('');
  console.log('   (o teste de recusa não precisa de criptograma: o simulador do sandbox só');
  console.log('   reage ao número em claro, enviado direto pelo script)');
  console.log('');
  console.log('   Depois rode de novo:  pnpm verificar:pagbank');
  console.log('');
  process.exit(resultados.every((r) => r.ok) ? 0 : 1);
}

// Valida cada blob ANTES de gastar uma tentativa no PagBank: base64 cortado
// ou com espaço no meio vira "INVALID BASE64" do lado deles (visto na rodada
// de 2026-08-03). O sintoma clássico é colar o Resultado com quebra de linha —
// o .env só lê a primeira linha e o resto do código fica de fora.
{
  const blobs = [
    ['BORA_PAGBANK_CARTAO_APROVADO_CRIPTO', blobAprovado],
    ['BORA_PAGBANK_CARTAO_APROVADO_CRIPTO_2', blobAprovado2],
  ];
  let algumRuim = false;
  for (const [nome, blob] of blobs) {
    const semAspas = blob.replace(/^["']|["']$/g, '');
    const pareceBase64 = /^[A-Za-z0-9+/]+=*$/.test(semAspas) && semAspas.length % 4 === 0;
    if (!pareceBase64) {
      algumRuim = true;
      console.log(`❌ ${nome} não parece um base64 completo (${semAspas.length} caracteres).`);
    } else if (semAspas.length < 200) {
      algumRuim = true;
      console.log(`❌ ${nome} está curto demais (${semAspas.length} caracteres) — provavelmente`);
      console.log('   só a primeira linha do Resultado foi parar no .env.');
    }
  }
  // O sandbox marca cada criptograma como usado PARA SEMPRE (40002). O script
  // guarda a impressão digital dos blobs já gastos e recusa repetição ANTES de
  // queimar mais uma rodada. Se um blob "novo" repetir, o gerador do portal é
  // determinístico: mude o NOME do portador para forçar um resultado diferente.
  const arquivoUsados = resolve(raiz, '.verificar-pagbank-usados.json');
  let usados = [];
  try {
    usados = JSON.parse(readFileSync(arquivoUsados, 'utf8'));
  } catch {
    /* primeira rodada: sem histórico */
  }
  const hash = (blob) => createHash('sha256').update(blob).digest('hex');
  for (const [nome, blob] of blobs) {
    if (usados.includes(hash(blob))) {
      algumRuim = true;
      console.log(`❌ ${nome} é um criptograma JÁ GASTO numa rodada anterior.`);
    }
  }
  if (algumRuim) {
    console.log('');
    console.log('   Cada criptograma vale UMA autorização, para sempre. Se você gerou um');
    console.log('   "novo" e ele repetiu, o gerador devolve o mesmo resultado para os mesmos');
    console.log('   dados — mude o NOME do portador a cada geração (ex.: Teste Bora A,');
    console.log('   Teste Bora B, Teste Bora C) para forçar resultados diferentes.');
  }

  if (algumRuim) {
    console.log('');
    console.log('   Como corrigir: no gerador do portal, copie o Resultado INTEIRO (se houver');
    console.log('   botão de copiar, use-o). No Bloco de Notas, o valor precisa ficar TODO na');
    console.log('   mesma linha do nome, sem espaços nem Enter no meio:');
    console.log('');
    console.log('   BORA_PAGBANK_CARTAO_APROVADO_CRIPTO=abc...tudo...xyz');
    console.log('');
    console.log('   Dica: desligue a "Quebra automática de linha" no Bloco de Notas (menu');
    console.log('   Exibir) para enxergar se o valor está mesmo numa linha só.');
    console.log('');
    console.log('   Lembre: cada criptograma vale UMA vez. Gere resultados NOVOS para as três');
    console.log('   variáveis antes de rodar de novo.');
    process.exit(1);
  }

  // Blobs válidos e inéditos: registra as impressões digitais AGORA, porque a
  // partir do passo 2 eles estarão gastos, dê o roteiro certo ou errado.
  writeFileSync(
    arquivoUsados,
    JSON.stringify([...usados, ...blobs.map(([, blob]) => hash(blob))], null, 2),
  );
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Consulta com paciência: o GET /charges respondeu 404 (resource_not_found)
 * logo após a criação na rodada de 2026-08-03 — sendo que a CAPTURA no mesmo
 * id funcionou. Consistência eventual do lado deles: a cobrança existe, mas a
 * leitura demora a enxergar. Espera e insiste antes de declarar derrota.
 */
async function consultarComPaciencia(id) {
  let ultimoErro = null;
  for (let tentativa = 1; tentativa <= 5; tentativa += 1) {
    try {
      return await adapter.getPayment(id);
    } catch (e) {
      ultimoErro = e;
      const naoAchou = e?.code === 'HTTP_404';
      if (!naoAchou) throw e;
      if (tentativa < 5) {
        console.log(`   · consulta ainda não enxerga a cobrança (404) — aguardando 10 s (${tentativa}/4)`);
        await dormir(10000);
      }
    }
  }
  throw ultimoErro;
}

const metadataAprovado = {
  encryptedCard: blobAprovado,
  customerTaxId: CPF_TESTE,
  holderName: PORTADOR,
  // Obrigatório na prática (erro 40001) apesar de "opcional" na documentação.
  customerEmail: EMAIL_COMPRADOR,
};

try {
  // 2. Pré-autorização (o teto)
  let chargeId = null;
  {
    const r = await adapter.authorize({
      amountCents: VALOR_RESERVA,
      method: 'CREDIT_CARD',
      idempotencyKey: chaveIdempotencia(),
      description: 'Bora Carregar verificacao',
      metadata: metadataAprovado,
    });
    chargeId = r.providerPaymentId || null;
    const ok = r.status === 'AUTHORIZED' && Boolean(chargeId);
    registrar(
      ok,
      `2. Reserva de ${reais(VALOR_RESERVA)} (capture:false)`,
      ok ? `cobrança ${chargeId}` : limpo(`status ${r.status} · ${JSON.stringify(r.raw).slice(0, 300)}`),
    );
    if (!ok) throw new Error('sem reserva não há o que capturar');
  }

  // Daqui em diante, um passo que falhe NÃO derruba os seguintes.

  // 3. O adapter enxerga a reserva
  try {
    const r = await consultarComPaciencia(chargeId);
    registrar(
      r.status === 'AUTHORIZED',
      '3. Consulta pelo adapter mostra a reserva em pé',
      `status ${r.status}, autorizado ${r.amountAuthorizedCents}`,
    );
  } catch (e) {
    registrar(false, '3. Consulta pelo adapter mostra a reserva em pé', detalheDoErro(e));
  }

  // 4. Captura de valor MENOR que o reservado. É o produto inteiro.
  const tituloCaptura = `4. Captura PARCIAL de ${reais(VALOR_CAPTURA)} sobre ${reais(VALOR_RESERVA)} reservados`;
  try {
    const r = await adapter.capture(chargeId, VALOR_CAPTURA);
    registrar(
      r.status === 'CAPTURED' && r.amountCapturedCents === VALOR_CAPTURA,
      tituloCaptura,
      `status ${r.status}, capturado ${r.amountCapturedCents}`,
    );
  } catch (e) {
    registrar(false, tituloCaptura, detalheDoErro(e));
  }

  // 5. A consulta confirma a captura
  try {
    const r = await consultarComPaciencia(chargeId);
    registrar(
      r.status === 'CAPTURED' && r.amountCapturedCents === VALOR_CAPTURA,
      `5. Consulta confirma ${reais(VALOR_CAPTURA)} cobrados`,
      `status ${r.status}, capturado ${r.amountCapturedCents}, devolvido ${r.amountRefundedCents}`,
    );
  } catch (e) {
    registrar(false, `5. Consulta confirma ${reais(VALOR_CAPTURA)} cobrados`, detalheDoErro(e));
  }

  // 6. Devolução do valor cobrado.
  //
  // O valor vai explícito (a descoberta pela consulta está coberta por teste
  // de unidade e sofreria com o 404 transitório à toa). Logo após a captura o
  // PagBank responde 40008 (captura assentando); o adapter marca esse erro
  // como retryable e aqui esperamos e insistimos, como o settlement faria.
  {
    const TENTATIVAS = 5;
    let resultado = null;
    let ultimoErro = null;
    for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa += 1) {
      try {
        resultado = await adapter.refund(chargeId, VALOR_CAPTURA);
        break;
      } catch (e) {
        ultimoErro = e;
        const aguardavel = e?.code === 'REFUND_TEMPORARILY_UNAVAILABLE' || e?.code === 'HTTP_404';
        if (!aguardavel) break;
        if (tentativa < TENTATIVAS) {
          console.log(`   · captura ainda assentando — aguardando 15 s (${tentativa}/${TENTATIVAS - 1})`);
          await dormir(15000);
        }
      }
    }
    if (resultado) {
      registrar(
        resultado.status === 'REFUNDED' && resultado.amountRefundedCents === VALOR_CAPTURA,
        `6. Devolução dos ${reais(VALOR_CAPTURA)}`,
        `status ${resultado.status}, devolvido ${resultado.amountRefundedCents}`,
      );
    } else {
      registrar(false, `6. Devolução dos ${reais(VALOR_CAPTURA)}`, detalheDoErro(ultimoErro));
    }
  }

  // 7. Nova reserva e cancelamento SEM captura (o caso "recarga não aconteceu")
  try {
    const r2 = await adapter.authorize({
      amountCents: VALOR_RESERVA_2,
      method: 'CREDIT_CARD',
      idempotencyKey: chaveIdempotencia(),
      description: 'Bora Carregar cancelamento',
      // Segundo blob: o do passo 2 já foi gasto (criptograma é de uso único).
      metadata: { ...metadataAprovado, encryptedCard: blobAprovado2 },
    });
    if (r2.status === 'AUTHORIZED' && r2.providerPaymentId) {
      const r = await adapter.voidPayment(r2.providerPaymentId);
      registrar(
        r.status === 'VOIDED',
        `7. Reserva de ${reais(VALOR_RESERVA_2)} cancelada sem cobrar nada`,
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
    registrar(false, `7. Reserva de ${reais(VALOR_RESERVA_2)} cancelada sem cobrar nada`, detalheDoErro(e));
  }

  // 8. Recusa do emissor — com o cartão da aba "Negada", NÚMERO EM CLARO.
  //
  // Em PRODUÇÃO este passo é pulado: não existe cartão de recusa em produção
  // e forçar recusa real dispara antifraude. A recusa foi provada no sandbox
  // (8/8 de 2026-08-04) — e o registro vale como aprovado por essa evidência.
  if (producao) {
    registrar(true, '8. Recusa do emissor — provada no sandbox (pulada em produção)', '8/8 de 2026-08-04');
  } else
  //
  // O sandbox aprovou esse cartão em pré-autorização E em cobrança direta
  // quando veio criptografado (rodadas de 2026-08-03): o simulador de recusa
  // só reage ao número em claro. O cartão é FICTÍCIO e publicado pelo próprio
  // portal — não existe portador. A chamada é feita direto pelo script
  // porque o adapter se recusa a tocar em número de cartão, regra que
  // continua valendo em produção. Mesmo desenho do roteiro da Rede.
  try {
    const resposta = await fetchInstrumentado(`${baseUrl.replace(/\/+$/, '')}/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: '*/*',
      },
      body: JSON.stringify({
        reference_id: chaveIdempotencia(),
        customer: { name: PORTADOR, email: 'teste@sonare.com.br', tax_id: CPF_TESTE },
        items: [{ name: 'Bora Carregar teste de recusa', quantity: 1, unit_amount: 1000 }],
        charges: [
          {
            reference_id: chaveIdempotencia(),
            description: 'Bora Carregar recusa',
            amount: { value: 1000, currency: 'BRL' },
            payment_method: {
              type: 'CREDIT_CARD',
              installments: 1,
              capture: true,
              card: {
                number: CARTOES_DE_TESTE_SANDBOX.recusados[0].numero,
                exp_month: 12,
                exp_year: 2030,
                security_code: CARTOES_DE_TESTE_SANDBOX.cvv,
                holder: { name: PORTADOR },
              },
            },
          },
        ],
      }),
    });
    const corpo = await resposta.json().catch(() => ({}));
    const cobranca = Array.isArray(corpo.charges) ? corpo.charges[0] : undefined;
    const status = cobranca?.status ?? '(sem cobrança)';
    const codigo = cobranca?.payment_response?.code ?? '—';
    const recusada = status === 'DECLINED';
    registrar(
      recusada,
      '8. Recusa do emissor é tratada como recusa (cobrança direta)',
      recusada
        ? `status ${status}, código ${codigo}`
        : limpo(`HTTP ${resposta.status} · status ${status} · ${JSON.stringify(corpo).slice(0, 200)}`),
    );
    // Se o sandbox aprovar até a cobrança direta, desfaz para não deixar lixo.
    if (!recusada && cobranca?.id && (status === 'PAID' || status === 'AUTHORIZED')) {
      await fetchInstrumentado(`${baseUrl.replace(/\/+$/, '')}/charges/${cobranca.id}/cancel`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: '*/*',
        },
        body: JSON.stringify({ amount: { value: 1000 } }),
      }).catch(() => {});
    }
  } catch (e) {
    registrar(false, '8. Recusa do emissor é tratada como recusa (cobrança direta)', detalheDoErro(e));
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

// Grava os logs das requisições — em produção eles são a última exigência da
// homologação (chamado 1424039934): enviar ao time de integração do PagBank.
const arquivoLogs = resolve(raiz, `pagbank-logs-${ambiente}-${Date.now()}.json`);
writeFileSync(
  arquivoLogs,
  JSON.stringify(
    {
      ambiente,
      geradoEm: new Date().toISOString(),
      resultado: `${ok} de ${total} passos aprovados`,
      passos: resultados,
      requisicoes: logsRequisicoes,
    },
    null,
    2,
  ),
);

console.log('');
console.log('==================================================');
console.log(`Resultado: ${ok} de ${total} passos aprovados`);
console.log('');
console.log(`Logs das requisições gravados em: ${arquivoLogs}`);
if (producao) {
  console.log('→ Este é o arquivo que o PagBank pediu no chamado 1424039934: anexe-o na');
  console.log('  resposta do e-mail de homologação (token e criptogramas já redigidos).');
}
console.log('');
if (ok === total && total >= 8) {
  console.log('Tudo passou. COPIE TODA ESTA SAÍDA e cole no chat — a decisão de');
  console.log('ligar BORA_PAGBANK_VERIFIED=true é tomada lá, com esta evidência.');
} else {
  console.log('Nem tudo passou. COPIE TODA ESTA SAÍDA e cole no chat, que eu');
  console.log('analiso o que o PagBank respondeu. NÃO mude BORA_PAGBANK_VERIFIED.');
}
console.log('');
