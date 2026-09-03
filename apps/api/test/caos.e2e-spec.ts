import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { OcppSimulator } from '@bora/ocpp-simulator';
import type { MockPaymentProvider } from '@bora/payment-core';
import { PrismaService } from '../src/prisma/prisma.service';
import { OcppGateway } from '../src/modules/ocpp/ocpp.gateway';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { PaymentProviderRegistry } from '../src/modules/payments/payment-provider.registry';
import { SessionWorker } from '../src/modules/payments/session-worker.service';
import { AlertsService } from '../src/modules/alerts/alerts.service';
import type { AuthenticatedUser } from '../src/modules/auth/strategies/jwt.strategy';
import { createTestApp } from './setup-app';

/**
 * Testes de caos (FASE 9).
 *
 * O que existe aqui é o que VAI acontecer no poste: o 4G cai no meio da
 * recarga, o adquirente sai do ar na hora de cobrar, o carregador some sem se
 * despedir. Cada cenário prova uma de duas coisas: ou o sistema se recupera
 * sozinho, ou o problema **aparece como alerta** — nunca a terceira opção, que
 * é sumir em silêncio. É o critério da fase: nenhuma sessão sem estado
 * definido.
 */

const IDENTITY = 'TEST-CAOS-001';

const ADMIN: AuthenticatedUser = {
  id: 'admin-caos',
  email: 'caos@teste',
  role: 'SUPER_ADMIN',
  organizationId: null,
};

let app: INestApplication;
let prisma: PrismaService;
let payments: PaymentsService;
let providers: PaymentProviderRegistry;
let worker: SessionWorker;
let alerts: AlertsService;
let baseUrl: string;

let organizationId: string;
let siteId: string;
let chargerId: string;
let connectorId: string;

const simuladores: OcppSimulator[] = [];

function novoSimulador(options: Record<string, unknown> = {}) {
  const sim = new OcppSimulator({
    url: baseUrl,
    chargePointIdentity: IDENTITY,
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
  providers = app.get(PaymentProviderRegistry);
  worker = app.get(SessionWorker);
  alerts = app.get(AlertsService);

  await app.listen(0);
  app.get(OcppGateway).attach(app.getHttpServer() as Server);

  const endereco = (app.getHttpServer() as Server).address();
  const porta = typeof endereco === 'object' && endereco ? endereco.port : 0;
  baseUrl = `ws://127.0.0.1:${porta}/ocpp`;

  const org = await prisma.organization.upsert({
    where: { slug: 'caos-e2e' },
    update: {},
    create: { name: 'Org Caos E2E', slug: 'caos-e2e' },
  });
  organizationId = org.id;

  const site = await prisma.site.upsert({
    where: { organizationId_name: { organizationId, name: 'Site Caos E2E' } },
    update: {},
    create: { organizationId, name: 'Site Caos E2E' },
  });
  siteId = site.id;
});

beforeEach(async () => {
  await limpar();

  const charger = await prisma.charger.create({
    data: { siteId, chargePointIdentity: IDENTITY, name: 'Carregador do caos' },
  });
  chargerId = charger.id;

  const connector = await prisma.connector.create({
    data: { chargerId, connectorNumber: 1, connectorType: 'CCS2', ratedPowerKw: 30 },
  });
  connectorId = connector.id;

  await prisma.tariff.create({
    data: {
      organizationId,
      siteId,
      name: 'Tarifa do caos',
      pricePerKwhCents: 250,
      connectionFeeCents: 300,
    },
  });
});

afterEach(async () => {
  // O comportamento do provedor simulado é estado global — um teste que o
  // quebra de propósito não pode contaminar o seguinte.
  (providers.get('mock') as MockPaymentProvider).setBehavior({});
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

  await prisma.terminal.deleteMany({ where: { site: { organizationId } } });
  await prisma.ocppMessage.deleteMany({ where: { charger: { site: { organizationId } } } });
  await prisma.connector.deleteMany({ where: { charger: { site: { organizationId } } } });
  await prisma.charger.deleteMany({ where: { siteId } });
  await prisma.tariff.deleteMany({ where: { organizationId } });
}

// ===========================================================================

describe('queda de conexão no meio da recarga (o 4G caiu)', () => {
  it('a medição continua na MESMA sessão depois da reconexão, e a cobrança sai certa', async () => {
    const sim = await simuladorPronto();

    const resultado = await payments.startPaidSession({
      connectorId,
      method: 'CREDIT_CARD',
      amountCents: 20_000,
    });
    await aguardarCarregando(sim, resultado.sessionId);

    // Primeira parte da recarga, com a conexão de pé.
    sim.advanceMeter(1000);
    await sim.meterValues(1);
    await aguardar(async () => {
      const s = await prisma.chargingSession.findUnique({ where: { id: resultado.sessionId } });
      return (s?.energyWh ?? 0) >= 1000;
    });

    /**
     * O sinal cai SEM despedida — `terminate`, não `close`. O carregador de
     * verdade continua carregando o carro e medindo; só a comunicação morre.
     */
    sim.simulateConnectionLoss();
    sim.advanceMeter(1500); // o carro seguiu carregando no escuro

    // O 4G volta. O mesmo equipamento reconecta, com a MESMA transação.
    await sim.connect();
    await sim.meterValues(1);

    await aguardar(
      async () => {
        const s = await prisma.chargingSession.findUnique({ where: { id: resultado.sessionId } });
        return (s?.energyWh ?? 0) >= 2500;
      },
      { descricao: 'medição acumulada após a reconexão' },
    );

    // O encerramento fecha a MESMA sessão, com a energia inteira.
    await sim.stopTransaction('Local');
    await aguardar(async () => {
      const s = await prisma.chargingSession.findUnique({ where: { id: resultado.sessionId } });
      return s?.status === 'COMPLETED';
    });

    const fechamento = await payments.settleSession(resultado.sessionId);
    expect(fechamento.settled).toBe(true);

    const sessao = await prisma.chargingSession.findUniqueOrThrow({
      where: { id: resultado.sessionId },
      include: { payment: true },
    });

    // 2,5 kWh × R$ 2,50 + R$ 3,00 = R$ 9,25 — nenhum Wh se perdeu na queda.
    expect(sessao.energyWh).toBe(2500);
    expect(sessao.finalAmountCents).toBe(925);
    expect(sessao.payment?.status).toBe('CAPTURED');
    expect(sessao.payment?.amountCapturedCents).toBe(925);
  });
});

describe('adquirente fora do ar na hora de cobrar', () => {
  it('o worker retenta e captura quando o adquirente volta — a cobrança atrasa, não se perde', async () => {
    const sim = await simuladorPronto();

    const resultado = await payments.startPaidSession({
      connectorId,
      method: 'CREDIT_CARD',
      amountCents: 20_000,
    });
    await aguardarCarregando(sim, resultado.sessionId);

    sim.advanceMeter(2000);
    await sim.meterValues(1);
    await aguardar(async () => {
      const s = await prisma.chargingSession.findUnique({ where: { id: resultado.sessionId } });
      return (s?.energyWh ?? 0) >= 2000;
    });

    await sim.stopTransaction('Local');
    await aguardar(async () => {
      const s = await prisma.chargingSession.findUnique({ where: { id: resultado.sessionId } });
      return s?.status === 'COMPLETED';
    });

    // O adquirente cai ANTES do fechamento.
    const mock = providers.get('mock') as MockPaymentProvider;
    mock.setBehavior({ failCapture: true });

    await worker.tick();

    const aindaAberta = await prisma.chargingSession.findUniqueOrThrow({
      where: { id: resultado.sessionId },
    });
    // Sem valor final — e é assim que deve ficar: valor final com captura
    // falhada seria mentir que cobrou.
    expect(aindaAberta.finalAmountCents).toBeNull();

    // O adquirente volta. O relógio anda além do espaçamento da retentativa.
    mock.setBehavior({});
    const futuro = new Date(Date.now() + 10 * 60_000);
    await worker.tick(futuro);

    const fechada = await prisma.chargingSession.findUniqueOrThrow({
      where: { id: resultado.sessionId },
      include: { payment: true },
    });

    expect(fechada.finalAmountCents).toBe(800); // 2 kWh × R$2,50 + R$3,00
    expect(fechada.payment?.status).toBe('CAPTURED');
    expect(fechada.payment?.amountCapturedCents).toBe(800);
  });
});

describe('o que trava tem que APARECER (alertas da FASE 9)', () => {
  it('carregador que some no meio da recarga vira alerta de sessão sem medição', async () => {
    const sim = await simuladorPronto();

    const resultado = await payments.startPaidSession({
      connectorId,
      method: 'CREDIT_CARD',
      amountCents: 20_000,
    });
    await aguardarCarregando(sim, resultado.sessionId);

    sim.advanceMeter(500);
    await sim.meterValues(1);
    await aguardar(async () => {
      const s = await prisma.chargingSession.findUnique({ where: { id: resultado.sessionId } });
      return (s?.energyWh ?? 0) >= 500;
    });

    // O carregador morre e NÃO volta. A sessão fica em CHARGING no banco.
    sim.simulateConnectionLoss();

    // Onze minutos depois (o limiar é dez), o alerta TEM que existir.
    const daquiOnzeMinutos = new Date(Date.now() + 11 * 60_000);
    const alertas = await alerts.evaluate(ADMIN, daquiOnzeMinutos);

    const zumbi = alertas.find(
      (a) => a.code === 'SESSAO_SEM_MEDICAO' && a.entityId === resultado.sessionId,
    );
    expect(zumbi).toBeDefined();
    expect(zumbi?.severity).toBe('CRITICAL');
    expect(zumbi?.runbook).toBe('sessao-sem-medicao');
  });

  it('recarga encerrada e não cobrada vira alerta de cobrança pendente', async () => {
    const sim = await simuladorPronto();

    const resultado = await payments.startPaidSession({
      connectorId,
      method: 'CREDIT_CARD',
      amountCents: 20_000,
    });
    await aguardarCarregando(sim, resultado.sessionId);

    sim.advanceMeter(1000);
    await sim.meterValues(1);
    await sim.stopTransaction('Local');
    await aguardar(async () => {
      const s = await prisma.chargingSession.findUnique({ where: { id: resultado.sessionId } });
      return s?.status === 'COMPLETED';
    });

    // O fechamento NÃO rodou (adquirente fora, worker parado — tanto faz).
    const seisMinutosDepois = new Date(Date.now() + 6 * 60_000);
    const alertas = await alerts.evaluate(ADMIN, seisMinutosDepois);

    const pendente = alertas.find(
      (a) => a.code === 'COBRANCA_PENDENTE' && a.entityId === resultado.sessionId,
    );
    expect(pendente).toBeDefined();
    expect(pendente?.severity).toBe('CRITICAL');
  });

  it('carregador offline e maquininha muda aparecem, cada um com seu roteiro', async () => {
    await prisma.charger.update({
      where: { id: chargerId },
      data: { connectionStatus: 'OFFLINE', lastSeenAt: new Date(Date.now() - 3_600_000) },
    });

    await prisma.terminal.create({
      data: {
        siteId,
        connectorId,
        name: 'Maquininha sumida',
        tokenHash: 'hash-de-teste',
        pairedAt: new Date(Date.now() - 86_400_000),
        lastSeenAt: new Date(Date.now() - 30 * 60_000),
      },
    });

    const alertas = await alerts.evaluate(ADMIN);

    expect(alertas.some((a) => a.code === 'CARREGADOR_OFFLINE')).toBe(true);
    expect(alertas.some((a) => a.code === 'MAQUININHA_MUDA')).toBe(true);

    // Todo alerta aponta um roteiro — alerta sem "e agora?" só gera pânico.
    for (const a of alertas) {
      expect(a.runbook).toBeTruthy();
      expect(a.message).toBeTruthy();
    }
  });

  it('operador de OUTRO estabelecimento não vê os alertas deste', async () => {
    await prisma.charger.update({
      where: { id: chargerId },
      data: { connectionStatus: 'OFFLINE' },
    });

    const outroOperador: AuthenticatedUser = {
      id: 'outro',
      email: 'outro@teste',
      role: 'ORG_ADMIN',
      // Organização que não existe — o filtro tem que devolver vazio, nunca
      // os alertas alheios.
      organizationId: '00000000-0000-4000-8000-000000000000',
    };

    const alertas = await alerts.evaluate(outroOperador);
    expect(alertas).toHaveLength(0);
  });
});
