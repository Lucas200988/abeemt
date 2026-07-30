import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { OcppSimulator } from '@bora/ocpp-simulator';
import { PrismaService } from '../src/prisma/prisma.service';
import { OcppGateway } from '../src/modules/ocpp/ocpp.gateway';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { PaymentWebhooksService } from '../src/modules/payments/payment-webhooks.service';
import { PaymentProviderRegistry } from '../src/modules/payments/payment-provider.registry';
import { SessionWorker } from '../src/modules/payments/session-worker.service';
import { SessionPricingService } from '../src/modules/pricing/session-pricing.service';
import { createTestApp } from './setup-app';

/**
 * Fluxo financeiro completo, com OCPP real.
 *
 * O provedor é simulado — não existe sandbox de adquirente aqui, e a regra 18.20
 * proíbe chamada real de pagamento sem ele. Tudo o mais é verdadeiro: WebSocket,
 * banco, cálculo, parada automática e captura.
 *
 * O que estes testes provam é justamente o que não dá para provar lendo o
 * código: que a energia medida vira valor cobrado, e que o valor cobrado nunca
 * passa do que foi reservado.
 */

const IDENTITY = 'TEST-PAY-001';

let app: INestApplication;
let prisma: PrismaService;
let payments: PaymentsService;
let webhooks: PaymentWebhooksService;
let providers: PaymentProviderRegistry;
let worker: SessionWorker;
let pricing: SessionPricingService;
let baseUrl: string;

let organizationId: string;
let siteId: string;
let chargerId: string;
let connectorId: string;
let tariffId: string;

const simuladores: OcppSimulator[] = [];

function novoSimulador(options: Record<string, unknown> = {}) {
  const sim = new OcppSimulator({
    url: baseUrl,
    chargePointIdentity: IDENTITY,
    // Medição rápida: o teste da parada automática precisa de várias leituras.
    meterIntervalMs: 150,
    heartbeatIntervalMs: 5000,
    autoReconnect: false,
    initialMeterWh: 1_000_000,
    ...options,
  } as never);

  simuladores.push(sim);
  return sim;
}

async function aguardar(
  condicao: () => Promise<boolean> | boolean,
  { timeoutMs = 10_000, intervaloMs = 25, descricao = 'condição' } = {},
): Promise<void> {
  const limite = Date.now() + timeoutMs;

  while (Date.now() < limite) {
    if (await condicao()) return;
    await new Promise((r) => setTimeout(r, intervaloMs));
  }

  throw new Error(`tempo esgotado aguardando: ${descricao}`);
}

/** Deixa o simulador conectado, plugado e pronto para receber o comando. */
async function simuladorPronto(options: Record<string, unknown> = {}) {
  const sim = novoSimulador(options);
  await sim.connect();
  await sim.bootNotification();
  await sim.plugIn(1);

  await aguardar(
    async () => {
      const c = await prisma.connector.findUnique({ where: { id: connectorId } });
      return c?.status === 'PREPARING';
    },
    { descricao: 'conector em PREPARING' },
  );

  return sim;
}

/**
 * Espera a recarga estar em curso dos DOIS lados.
 *
 * Só checar o banco não basta: o servidor grava `CHARGING` antes de responder o
 * `StartTransaction`, então há um instante em que a sessão já está carregando e
 * o simulador ainda não recebeu o `transactionId`. Um teste que parasse de
 * esperar aí falharia de forma intermitente ao tentar encerrar a transação.
 */
async function aguardarCarregando(sim: OcppSimulator, sessionId: string) {
  await aguardar(
    async () => {
      const s = await prisma.chargingSession.findUnique({ where: { id: sessionId } });
      return s?.status === 'CHARGING' && sim.transactionId !== null;
    },
    { descricao: 'recarga em curso no servidor e no carregador' },
  );
}

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  payments = app.get(PaymentsService);
  webhooks = app.get(PaymentWebhooksService);
  providers = app.get(PaymentProviderRegistry);
  worker = app.get(SessionWorker);
  pricing = app.get(SessionPricingService);

  await app.listen(0);
  app.get(OcppGateway).attach(app.getHttpServer() as Server);

  const endereco = (app.getHttpServer() as Server).address();
  const porta = typeof endereco === 'object' && endereco ? endereco.port : 0;
  baseUrl = `ws://127.0.0.1:${porta}/ocpp`;

  const org = await prisma.organization.upsert({
    where: { slug: 'pay-e2e' },
    update: {},
    create: { name: 'Org Pagamentos E2E', slug: 'pay-e2e' },
  });
  organizationId = org.id;

  const site = await prisma.site.upsert({
    where: { organizationId_name: { organizationId, name: 'Site Pagamentos E2E' } },
    update: {},
    create: { organizationId, name: 'Site Pagamentos E2E' },
  });
  siteId = site.id;
});

beforeEach(async () => {
  await limpar();

  const charger = await prisma.charger.create({
    data: { siteId, chargePointIdentity: IDENTITY, name: 'Carregador de pagamento' },
  });
  chargerId = charger.id;

  const connector = await prisma.connector.create({
    data: { chargerId, connectorNumber: 1, connectorType: 'CCS2', ratedPowerKw: 30 },
  });
  connectorId = connector.id;

  // R$ 2,50/kWh e R$ 3,00 de taxa de conexão — ordem de grandeza real de um
  // ponto de recarga rápida no Brasil.
  const tariff = await prisma.tariff.create({
    data: {
      organizationId,
      siteId,
      name: 'Tarifa de teste',
      pricePerKwhCents: 250,
      connectionFeeCents: 300,
    },
  });
  tariffId = tariff.id;
});

afterEach(async () => {
  await Promise.all(simuladores.splice(0).map((s) => s.disconnect().catch(() => undefined)));
});

afterAll(async () => {
  await limpar();
  await prisma.site.deleteMany({ where: { organizationId } });
  await prisma.organization.delete({ where: { id: organizationId } });
  await app.close();
});

async function limpar() {
  await prisma.meterValue.deleteMany({ where: { charger: { site: { organizationId } } } });
  await prisma.paymentEvent.deleteMany({ where: { payment: { session: { organizationId } } } });

  const sessoes = await prisma.chargingSession.findMany({
    where: { organizationId },
    select: { paymentId: true },
  });

  await prisma.chargingSession.deleteMany({ where: { organizationId } });
  await prisma.payment.deleteMany({
    where: { id: { in: sessoes.map((s) => s.paymentId).filter((id): id is string => !!id) } },
  });

  await prisma.ocppMessage.deleteMany({ where: { charger: { site: { organizationId } } } });
  await prisma.connector.deleteMany({ where: { charger: { site: { organizationId } } } });
  await prisma.charger.deleteMany({ where: { siteId } });
  await prisma.tariff.deleteMany({ where: { organizationId } });
}

// ===========================================================================

describe('provedores', () => {
  it('todos os provedores registrados atendem o modelo do produto', () => {
    // A validação real acontece no boot; aqui garantimos que ela existe e passa.
    expect(providers.names()).toContain('mock');
    expect(providers.names()).toContain('manual');
    expect(providers.default().capabilities.partialCapture).toBe(true);
  });

  it('o mock reserva sem cobrar', () => {
    expect(providers.get('mock').capabilities.preAuthorization).toBe(true);
  });
});

describe('ciclo completo: reserva, consumo, captura', () => {
  it('cobra apenas o consumido, bem abaixo do reservado', async () => {
    const sim = await simuladorPronto();

    const resultado = await payments.startPaidSession({
      connectorId,
      method: 'CREDIT_CARD',
      amountCents: 20_000,
    });

    expect(resultado.approved).toBe(true);
    expect(resultado.command?.accepted).toBe(true);
    // Reservou o teto inteiro: no início não há como saber quanto será consumido.
    expect(resultado.amountAuthorizedCents).toBe(20_000);

    const pagamento = await prisma.payment.findUniqueOrThrow({
      where: { id: resultado.paymentId },
    });
    expect(pagamento.status).toBe('AUTHORIZED');
    // O ponto do ADR-0008: reservado, nada cobrado ainda.
    expect(pagamento.amountCapturedCents).toBe(0);

    await aguardarCarregando(sim, resultado.sessionId);

    // 10 kWh entregues.
    sim.advanceMeter(10_000);
    await sim.meterValues(1);

    await aguardar(
      async () => {
        const s = await prisma.chargingSession.findUnique({ where: { id: resultado.sessionId } });
        return (s?.energyWh ?? 0) >= 10_000;
      },
      { descricao: 'energia registrada' },
    );

    await sim.stopTransaction('Remote');

    await aguardar(
      async () => {
        const s = await prisma.chargingSession.findUnique({ where: { id: resultado.sessionId } });
        return s?.status === 'COMPLETED';
      },
      { descricao: 'sessão concluída' },
    );

    const fechamento = await payments.settleSession(resultado.sessionId);
    expect(fechamento.settled).toBe(true);

    // 10 kWh × R$ 2,50 + R$ 3,00 de conexão = R$ 28,00.
    const sessao = await prisma.chargingSession.findUniqueOrThrow({
      where: { id: resultado.sessionId },
    });
    expect(sessao.finalAmountCents).toBe(2800);

    const cobrado = await prisma.payment.findUniqueOrThrow({ where: { id: resultado.paymentId } });
    expect(cobrado.status).toBe('CAPTURED');
    expect(cobrado.amountCapturedCents).toBe(2800);
    // A diferença entre reservado e cobrado é liberada pelo emissor.
    expect(cobrado.amountAuthorizedCents).toBe(20_000);
  });

  it('cancela a reserva quando não houve consumo nenhum', async () => {
    const sim = await simuladorPronto();

    const resultado = await payments.startPaidSession({ connectorId, method: 'CREDIT_CARD' });

    await aguardarCarregando(sim, resultado.sessionId);

    // Encerra sem avançar o medidor: o motorista desistiu.
    await sim.stopTransaction('EVDisconnected');

    await aguardar(async () => {
      const s = await prisma.chargingSession.findUnique({ where: { id: resultado.sessionId } });
      return s?.status === 'COMPLETED';
    });

    await payments.settleSession(resultado.sessionId);

    const pagamento = await prisma.payment.findUniqueOrThrow({ where: { id: resultado.paymentId } });
    // VOIDED, não REFUNDED: nada chegou a ser cobrado.
    expect(pagamento.status).toBe('VOIDED');
    expect(pagamento.amountCapturedCents).toBe(0);

    // Zero, e não os R$ 3,00 da taxa de conexão: a tarifa cobraria a taxa, mas a
    // regra comercial de `semEntregaNaoCobra` dispensa quem não recebeu energia.
    const sessao = await prisma.chargingSession.findUniqueOrThrow({
      where: { id: resultado.sessionId },
    });
    expect(sessao.finalAmountCents).toBe(0);
  });

  it('não cobra nada quando o carregador recusa o comando', async () => {
    await simuladorPronto({ rejectRemoteStart: true });

    const resultado = await payments.startPaidSession({ connectorId, method: 'CREDIT_CARD' });

    // O pagamento foi aprovado — o problema veio depois, no equipamento.
    expect(resultado.approved).toBe(true);
    expect(resultado.command?.accepted).toBe(false);
    expect(resultado.message).toMatch(/Nada foi cobrado/);

    const pagamento = await prisma.payment.findUniqueOrThrow({ where: { id: resultado.paymentId } });
    expect(pagamento.status).toBe('VOIDED');
    expect(pagamento.amountCapturedCents).toBe(0);
  });
});

describe('parada automática ao atingir o teto (risco R-22)', () => {
  /**
   * O teste mais importante da fase.
   *
   * Sem esta proteção, o consumo passa do valor reservado, o adquirente recusa a
   * captura do excedente e a energia entregue a mais é prejuízo direto.
   */
  it('encerra a recarga sozinha antes de ultrapassar o valor reservado', async () => {
    const sim = await simuladorPronto();

    // Teto baixo de propósito: R$ 10,00. Com R$ 3,00 de conexão e R$ 2,50/kWh,
    // o limiar de 95% (R$ 9,50) é cruzado com pouco mais de 2,5 kWh.
    const resultado = await payments.startPaidSession({
      connectorId,
      method: 'CREDIT_CARD',
      amountCents: 1000,
    });

    await aguardarCarregando(sim, resultado.sessionId);

    // 3 kWh: R$ 3,00 + R$ 7,50 = R$ 10,50, acima do limiar de R$ 9,50.
    sim.advanceMeter(3000);
    await sim.meterValues(1);

    await aguardar(
      async () => {
        const s = await prisma.chargingSession.findUnique({ where: { id: resultado.sessionId } });
        return s?.ceilingReachedAt !== null;
      },
      { descricao: 'marca de teto atingido' },
    );

    // A parada é de verdade: o comando chega ao carregador, que responde com
    // StopTransaction.
    await aguardar(
      async () => {
        const s = await prisma.chargingSession.findUnique({ where: { id: resultado.sessionId } });
        return s?.status === 'COMPLETED';
      },
      { descricao: 'recarga encerrada pelo comando automático' },
    );

    const sessao = await prisma.chargingSession.findUniqueOrThrow({
      where: { id: resultado.sessionId },
    });

    // O motivo registrado é o real, não "parada remota".
    expect(sessao.stopReason).toBe('CEILING_REACHED');

    await payments.settleSession(resultado.sessionId);

    const pagamento = await prisma.payment.findUniqueOrThrow({ where: { id: resultado.paymentId } });

    // A garantia que importa: nunca acima do reservado.
    expect(pagamento.amountCapturedCents).toBeLessThanOrEqual(1000);
    expect(pagamento.status).toBe('CAPTURED');
  });

  it('o limiar do Pix é mais alto que o do cartão (ADR-0010 §3)', () => {
    // No cartão, passar do teto é prejuízo nosso; no Pix, parar antes é entregar
    // menos do que o motorista pagou. Os incentivos se invertem.
    const cartao = pricing.autoStopThreshold(20_000, 'CREDIT_CARD');
    const pix = pricing.autoStopThreshold(20_000, 'PIX');

    expect(cartao).toBe(19_000);
    expect(pix).toBe(20_000);
    expect(pix).toBeGreaterThan(cartao);
  });

  it('não dispara em sessão sem teto', async () => {
    const sim = await simuladorPronto();

    // Sessão manual: sem pagamento e sem teto.
    const sessao = await prisma.chargingSession.create({
      data: {
        organizationId,
        siteId,
        chargerId,
        connectorId,
        status: 'PAYMENT_APPROVED',
        authorizedAt: new Date(),
      },
    });

    await app.get(PaymentsService); // mantém o serviço vivo para o teste
    await sim.startTransaction(1, 'MANUAL');
    sim.advanceMeter(50_000);
    await sim.meterValues(1);

    const depois = await prisma.chargingSession.findUniqueOrThrow({ where: { id: sessao.id } });
    expect(depois.ceilingReachedAt).toBeNull();
  });
});

describe('Pix (ADR-0010)', () => {
  it('cobra na hora, porque não existe captura parcial em Pix', async () => {
    await simuladorPronto();

    const resultado = await payments.startPaidSession({
      connectorId,
      method: 'PIX',
      amountCents: 5000,
    });

    const pagamento = await prisma.payment.findUniqueOrThrow({ where: { id: resultado.paymentId } });

    expect(pagamento.status).toBe('CAPTURED');
    expect(pagamento.amountCapturedCents).toBe(5000);
    // Identificador ponta a ponta, não dados de cartão.
    expect(pagamento.pixEndToEndId).toBeTruthy();
    expect(pagamento.cardLastFour).toBeNull();
  });

  it('devolve integralmente quando nenhuma energia foi entregue (ADR-0010 §4)', async () => {
    const sim = await simuladorPronto();

    const resultado = await payments.startPaidSession({
      connectorId,
      method: 'PIX',
      amountCents: 5000,
    });

    await aguardarCarregando(sim, resultado.sessionId);

    await sim.stopTransaction('EVDisconnected');

    await aguardar(async () => {
      const s = await prisma.chargingSession.findUnique({ where: { id: resultado.sessionId } });
      return s?.status === 'COMPLETED';
    });

    const fechamento = await payments.settleSession(resultado.sessionId);
    expect(fechamento.reason).toMatch(/devolvido/);

    const pagamento = await prisma.payment.findUniqueOrThrow({ where: { id: resultado.paymentId } });
    expect(pagamento.status).toBe('REFUNDED');
    expect(pagamento.amountRefundedCents).toBe(5000);
  });

  it('não devolve o troco quando houve consumo — valor fixo', async () => {
    const sim = await simuladorPronto();

    const resultado = await payments.startPaidSession({
      connectorId,
      method: 'PIX',
      amountCents: 5000,
    });

    await aguardarCarregando(sim, resultado.sessionId);

    sim.advanceMeter(1000);
    await sim.meterValues(1);

    await aguardar(async () => {
      const s = await prisma.chargingSession.findUnique({ where: { id: resultado.sessionId } });
      return (s?.energyWh ?? 0) >= 1000;
    });

    await sim.stopTransaction('Remote');
    await aguardar(async () => {
      const s = await prisma.chargingSession.findUnique({ where: { id: resultado.sessionId } });
      return s?.status === 'COMPLETED';
    });

    await payments.settleSession(resultado.sessionId);

    const pagamento = await prisma.payment.findUniqueOrThrow({ where: { id: resultado.paymentId } });
    // Consumiu R$ 5,50 de tarifa mas pagou R$ 50,00: sem devolução automática,
    // conforme a decisão registrada no ADR-0010.
    expect(pagamento.status).toBe('CAPTURED');
    expect(pagamento.amountRefundedCents).toBe(0);
  });
});

describe('idempotência e concorrência', () => {
  it('a mesma chave não gera dois pagamentos', async () => {
    await simuladorPronto();

    await payments.startPaidSession({
      connectorId,
      method: 'CREDIT_CARD',
      idempotencyKey: 'chave-repetida-e2e',
    });

    // Segunda tentativa com a mesma chave: recusada pelo índice único do banco.
    await expect(
      payments.startPaidSession({
        connectorId,
        method: 'CREDIT_CARD',
        idempotencyKey: 'chave-repetida-e2e',
      }),
    ).rejects.toMatchObject({ response: { code: expect.stringMatching(/DUPLICATE|CONNECTOR/) } });

    const total = await prisma.payment.count({ where: { idempotencyKey: 'chave-repetida-e2e' } });
    expect(total).toBe(1);
  });

  it('o segundo pagamento no mesmo conector é recusado ANTES de tocar no cartão', async () => {
    await simuladorPronto();

    await payments.startPaidSession({ connectorId, method: 'CREDIT_CARD' });

    await expect(
      payments.startPaidSession({ connectorId, method: 'CREDIT_CARD' }),
    ).rejects.toMatchObject({ response: { code: 'CONNECTOR_BUSY' } });

    // A prova de que nada foi cobrado do segundo motorista: só existe um
    // pagamento, e ele não está em nenhum estado que envolva dinheiro.
    const pagamentos = await prisma.payment.findMany({
      where: { session: { connectorId } },
    });
    expect(pagamentos).toHaveLength(1);
  });
});

describe('webhook', () => {
  it('recusa evento sem assinatura válida', async () => {
    await expect(webhooks.handle('mock', { eventId: 'x' }, {})).rejects.toMatchObject({
      response: { code: 'INVALID_WEBHOOK_SIGNATURE' },
    });
  });

  it('processa o evento e ignora o reenvio', async () => {
    await simuladorPronto();

    const resultado = await payments.startPaidSession({ connectorId, method: 'CREDIT_CARD' });
    const pagamento = await prisma.payment.findUniqueOrThrow({ where: { id: resultado.paymentId } });

    const evento = {
      eventId: 'evt-e2e-1',
      paymentId: pagamento.providerPaymentId,
      status: 'CAPTURED',
      amountCents: 1234,
    };
    const headers = { 'x-mock-signature': 'valida' };

    const primeira = await webhooks.handle('mock', evento, headers);
    expect(primeira.duplicate).toBe(false);

    // Adquirentes reenviam até receber 200. O reenvio não pode reprocessar.
    const segunda = await webhooks.handle('mock', evento, headers);
    expect(segunda.duplicate).toBe(true);

    const registrados = await prisma.paymentEvent.count({
      where: { provider: 'mock', eventId: 'evt-e2e-1' },
    });
    expect(registrados).toBe(1);

    const atualizado = await prisma.payment.findUniqueOrThrow({ where: { id: pagamento.id } });
    expect(atualizado.status).toBe('CAPTURED');
    expect(atualizado.amountCapturedCents).toBe(1234);
  });

  it('guarda evento de pagamento desconhecido em vez de descartar', async () => {
    const resposta = await webhooks.handle(
      'mock',
      { eventId: 'evt-orfao', paymentId: 'mock_999999', status: 'CAPTURED' },
      { 'x-mock-signature': 'valida' },
    );

    expect(resposta.received).toBe(true);

    const registro = await prisma.paymentEvent.findFirstOrThrow({
      where: { eventId: 'evt-orfao' },
    });
    expect(registro.processingError).toMatch(/não encontrado/);

    await prisma.paymentEvent.delete({ where: { id: registro.id } });
  });
});

describe('worker de timeouts (regra 11.5)', () => {
  it('expira a sessão e cancela a reserva quando o veículo não inicia', async () => {
    // O simulador aceita o comando mas nunca manda StartTransaction: é o caso do
    // cabo não conectado ou do veículo recusando a carga.
    await simuladorPronto({ neverStartTransaction: true });

    const resultado = await payments.startPaidSession({ connectorId, method: 'CREDIT_CARD' });
    expect(resultado.command?.accepted).toBe(true);

    const sessao = await prisma.chargingSession.findUniqueOrThrow({
      where: { id: resultado.sessionId },
    });
    expect(sessao.status).toBe('STARTING');
    // Instantes distintos: um é o pagamento, o outro é o comando.
    expect(sessao.commandSentAt).not.toBeNull();

    // Avançamos o relógio do worker em vez de esperar 5 minutos de verdade.
    const futuro = new Date(Date.now() + 10 * 60 * 1000);
    const passada = await worker.tick(futuro);

    expect(passada.aguardandoVeiculo).toBe(1);

    const expirada = await prisma.chargingSession.findUniqueOrThrow({
      where: { id: resultado.sessionId },
    });
    expect(expirada.status).toBe('EXPIRED');
    expect(expirada.failureReason).toMatch(/cabo/);

    const pagamento = await prisma.payment.findUniqueOrThrow({ where: { id: resultado.paymentId } });
    // O motorista não pode ficar com valor preso por uma recarga que não houve.
    expect(pagamento.status).toBe('VOIDED');
  });

  it('fecha sessões pendentes de cobrança na varredura', async () => {
    const sim = await simuladorPronto();

    const resultado = await payments.startPaidSession({ connectorId, method: 'CREDIT_CARD' });

    await aguardarCarregando(sim, resultado.sessionId);

    sim.advanceMeter(4000);
    await sim.meterValues(1);
    await aguardar(async () => {
      const s = await prisma.chargingSession.findUnique({ where: { id: resultado.sessionId } });
      return (s?.energyWh ?? 0) >= 4000;
    });

    await sim.stopTransaction('Remote');
    await aguardar(async () => {
      const s = await prisma.chargingSession.findUnique({ where: { id: resultado.sessionId } });
      return s?.status === 'COMPLETED';
    });

    // Ninguém chamou settleSession: quem fecha é o worker.
    const passada = await worker.tick();
    expect(passada.fechadas).toBeGreaterThanOrEqual(1);

    const pagamento = await prisma.payment.findUniqueOrThrow({ where: { id: resultado.paymentId } });
    // 4 kWh × R$ 2,50 + R$ 3,00 = R$ 13,00.
    expect(pagamento.amountCapturedCents).toBe(1300);
  });
});

describe('tarifa congelada na sessão', () => {
  it('mudar a tarifa depois não altera o valor de uma recarga já feita', async () => {
    const sim = await simuladorPronto();

    const resultado = await payments.startPaidSession({ connectorId, method: 'CREDIT_CARD' });

    await aguardarCarregando(sim, resultado.sessionId);

    sim.advanceMeter(2000);
    await sim.meterValues(1);
    await aguardar(async () => {
      const s = await prisma.chargingSession.findUnique({ where: { id: resultado.sessionId } });
      return (s?.energyWh ?? 0) >= 2000;
    });

    await sim.stopTransaction('Remote');
    await aguardar(async () => {
      const s = await prisma.chargingSession.findUnique({ where: { id: resultado.sessionId } });
      return s?.status === 'COMPLETED';
    });

    // Preço dobra ENTRE o fim da recarga e o fechamento.
    await prisma.tariff.update({ where: { id: tariffId }, data: { pricePerKwhCents: 500 } });

    await payments.settleSession(resultado.sessionId);

    const sessao = await prisma.chargingSession.findUniqueOrThrow({
      where: { id: resultado.sessionId },
    });

    // 2 kWh × R$ 2,50 + R$ 3,00 = R$ 8,00 — o preço de quando a recarga aconteceu.
    expect(sessao.finalAmountCents).toBe(800);
  });
});

describe('autorização vinda da maquininha (FASE 8)', () => {
  it('registra a pré-autorização do terminal e inicia a recarga', async () => {
    await simuladorPronto();

    const resultado = await payments.recordTerminalAuthorization({
      connectorId,
      provider: 'manual',
      providerPaymentId: 'NSU-123456',
      method: 'MANUAL',
      amountAuthorizedCents: 15_000,
      idempotencyKey: 'terminal-e2e-1',
      instrument: { cardBrand: 'VISA', cardLastFour: '4321', nsu: '123456' },
      terminalId: 'POS-01',
    });

    expect(resultado.approved).toBe(true);
    expect(resultado.command?.accepted).toBe(true);

    const pagamento = await prisma.payment.findUniqueOrThrow({ where: { id: resultado.paymentId } });
    expect(pagamento.status).toBe('AUTHORIZED');
    expect(pagamento.cardLastFour).toBe('4321');
    expect(pagamento.terminalId).toBe('POS-01');
    // O teto da sessão é o valor que a maquininha reservou, não a configuração.
    expect(resultado.ceilingAmountCents).toBeLessThanOrEqual(20_000);

    const sessao = await prisma.chargingSession.findUniqueOrThrow({
      where: { id: resultado.sessionId },
    });
    expect(sessao.ceilingAmountCents).toBe(15_000);
  });

  it('reenvio do terminal devolve o mesmo pagamento', async () => {
    await simuladorPronto();

    const primeira = await payments.recordTerminalAuthorization({
      connectorId,
      provider: 'manual',
      providerPaymentId: 'NSU-777',
      method: 'MANUAL',
      amountAuthorizedCents: 10_000,
      idempotencyKey: 'terminal-e2e-repetido',
    });

    const segunda = await payments.recordTerminalAuthorization({
      connectorId,
      provider: 'manual',
      providerPaymentId: 'NSU-777',
      method: 'MANUAL',
      amountAuthorizedCents: 10_000,
      idempotencyKey: 'terminal-e2e-repetido',
    });

    expect(segunda.paymentId).toBe(primeira.paymentId);
    expect(segunda.message).toMatch(/já registrado/);
  });
});

describe('ociosidade medida pelo OCPP (FASE 6)', () => {
  /**
   * O veículo termina de carregar e fica plugado. O medidor continua
   * reportando, com o mesmo valor — é assim que um carregador real se comporta.
   */
  it('acumula o tempo em que a energia não sobe', async () => {
    // `powerKw: 0` é o ponto do teste: sem potência, a medição periódica do
    // simulador repete a mesma leitura, que é exatamente como um carregador real
    // se comporta com o veículo cheio. Com potência, o medidor nunca fica
    // parado e a ociosidade jamais aconteceria.
    const sim = await simuladorPronto({ powerKw: 0 });

    const resultado = await payments.startPaidSession({
      connectorId,
      method: 'CREDIT_CARD',
      amountCents: 20_000,
    });

    await aguardarCarregando(sim, resultado.sessionId);

    // Primeira leitura com energia nova: não conta como ociosa, e não teria
    // como — não existe intervalo anterior para medir.
    sim.advanceMeter(2000);
    await sim.meterValues(1);

    await aguardar(async () => {
      const s = await prisma.chargingSession.findUnique({ where: { id: resultado.sessionId } });
      return (s?.energyWh ?? 0) >= 2000;
    });

    const aposCarga = await prisma.chargingSession.findUniqueOrThrow({
      where: { id: resultado.sessionId },
    });
    expect(aposCarga.idleSeconds).toBe(0);
    expect(aposCarga.lastMeterAt).not.toBeNull();

    // Agora o carro está cheio: o medidor repete a mesma leitura.
    await new Promise((r) => setTimeout(r, 1100));
    await sim.meterValues(1);

    await aguardar(
      async () => {
        const s = await prisma.chargingSession.findUnique({ where: { id: resultado.sessionId } });
        return (s?.idleSeconds ?? 0) >= 1;
      },
      { descricao: 'ociosidade acumulada' },
    );

    const ocioso = await prisma.chargingSession.findUniqueOrThrow({
      where: { id: resultado.sessionId },
    });

    // A energia não regrediu: leitura repetida não pode reduzir o que já foi medido.
    expect(ocioso.energyWh).toBe(aposCarga.energyWh);
    expect(ocioso.idleSeconds).toBeGreaterThanOrEqual(1);
  });

  it('a ociosidade entra no valor cobrado', async () => {
    // Tarifa com ociosidade: R$ 1,00 por minuto parado.
    await prisma.tariff.updateMany({
      where: { organizationId },
      data: { idleFeePerMinuteCents: 100, pricePerMinuteCents: 0 },
    });

    const sim = await simuladorPronto({ powerKw: 0 });

    const resultado = await payments.startPaidSession({
      connectorId,
      method: 'CREDIT_CARD',
      amountCents: 20_000,
    });

    await aguardarCarregando(sim, resultado.sessionId);

    sim.advanceMeter(4000);
    await sim.meterValues(1);
    await aguardar(async () => {
      const s = await prisma.chargingSession.findUnique({ where: { id: resultado.sessionId } });
      return (s?.energyWh ?? 0) >= 4000;
    });

    await sim.stopTransaction('Remote');
    await aguardar(async () => {
      const s = await prisma.chargingSession.findUnique({ where: { id: resultado.sessionId } });
      return s?.status === 'COMPLETED';
    });

    /**
     * Meia hora de sessão, dez minutos dela parada — gravados depois do
     * encerramento, quando não há mais medições disputando a mesma linha.
     *
     * A duração precisa ser coerente com a ociosidade: o cálculo limita o tempo
     * ocioso à duração total, e a primeira versão deste teste pedia 10 minutos
     * parados numa sessão de um segundo. O limite estava certo; o teste é que
     * descrevia algo impossível.
     */
    await prisma.chargingSession.update({
      where: { id: resultado.sessionId },
      data: { idleSeconds: 600, durationSeconds: 1800 },
    });

    await payments.settleSession(resultado.sessionId);

    const sessao = await prisma.chargingSession.findUniqueOrThrow({
      where: { id: resultado.sessionId },
    });

    // R$ 3,00 conexão + R$ 10,00 energia (4 kWh) + R$ 10,00 de ociosidade (10 min).
    expect(sessao.finalAmountCents).toBe(2300);

    const pagamento = await prisma.payment.findUniqueOrThrow({ where: { id: resultado.paymentId } });
    expect(pagamento.amountCapturedCents).toBe(2300);
  });
});
