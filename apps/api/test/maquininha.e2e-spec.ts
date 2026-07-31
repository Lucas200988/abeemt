import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { OcppSimulator } from '@bora/ocpp-simulator';
import { PrismaService } from '../src/prisma/prisma.service';
import { OcppGateway } from '../src/modules/ocpp/ocpp.gateway';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { TerminalsService } from '../src/modules/terminals/terminals.service';
import { createTestApp } from './setup-app';

/**
 * A maquininha, ponta a ponta (FASE 8, caminho A).
 *
 * Os testes batem no HTTP de verdade, com o token no cabeçalho, porque o que
 * precisa ser provado aqui é a **fronteira**: quem entra, o que consegue fazer, e
 * o que acontece quando o token vaza. Chamar os serviços direto pularia
 * exatamente a parte que importa.
 *
 * O provedor é simulado — não há sandbox de adquirente (regra 18.20). O resto é
 * verdadeiro: WebSocket OCPP, banco, cálculo de tarifa e captura.
 */

const IDENTITY = 'TEST-POS-001';

let app: INestApplication;
let prisma: PrismaService;
let payments: PaymentsService;
let terminals: TerminalsService;
let httpUrl: string;
let wsUrl: string;

let organizationId: string;
let siteId: string;
let chargerId: string;
let connectorId: string;

const simuladores: OcppSimulator[] = [];

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

async function simuladorPronto() {
  const sim = new OcppSimulator({
    url: wsUrl,
    chargePointIdentity: IDENTITY,
    meterIntervalMs: 150,
    heartbeatIntervalMs: 5000,
    autoReconnect: false,
    initialMeterWh: 1_000_000,
  } as never);

  simuladores.push(sim);

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

/** Chamada HTTP com o token da maquininha. */
async function comoTerminal(
  token: string | null,
  metodo: string,
  caminho: string,
  corpo?: unknown,
) {
  const resposta = await fetch(`${httpUrl}${caminho}`, {
    method: metodo,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });

  const texto = await resposta.text();

  return {
    status: resposta.status,
    body: texto ? (JSON.parse(texto) as Record<string, unknown>) : null,
  };
}

/** Cadastra um terminal e o pareia, devolvendo o token em claro. */
async function terminalPareado(): Promise<{ token: string; id: string }> {
  const terminal = await prisma.terminal.create({
    data: { siteId, connectorId, name: 'Maquininha de teste' },
  });

  const { pairingCode } = await terminals.generatePairingCode(
    { id: 'sys', email: 'sys@teste', role: 'SUPER_ADMIN', organizationId: null },
    terminal.id,
    {},
  );

  const { token } = await terminals.pair({ pairingCode, serialNumber: 'SN-TESTE' });

  return { token, id: terminal.id };
}

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  payments = app.get(PaymentsService);
  terminals = app.get(TerminalsService);

  await app.listen(0);
  app.get(OcppGateway).attach(app.getHttpServer() as Server);

  const endereco = (app.getHttpServer() as Server).address();
  const porta = typeof endereco === 'object' && endereco ? endereco.port : 0;
  wsUrl = `ws://127.0.0.1:${porta}/ocpp`;
  httpUrl = `http://127.0.0.1:${porta}/api/v1`;

  const org = await prisma.organization.upsert({
    where: { slug: 'pos-e2e' },
    update: {},
    create: { name: 'Org Maquininha E2E', slug: 'pos-e2e' },
  });
  organizationId = org.id;

  const site = await prisma.site.upsert({
    where: { organizationId_name: { organizationId, name: 'Site Maquininha E2E' } },
    update: {},
    create: { organizationId, name: 'Site Maquininha E2E' },
  });
  siteId = site.id;
});

beforeEach(async () => {
  await limpar();

  const charger = await prisma.charger.create({
    data: { siteId, chargePointIdentity: IDENTITY, name: 'Carregador da maquininha' },
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
      name: 'Tarifa da maquininha',
      pricePerKwhCents: 250,
      connectionFeeCents: 300,
    },
  });
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

  await prisma.terminal.deleteMany({ where: { siteId } });
  await prisma.ocppMessage.deleteMany({ where: { charger: { site: { organizationId } } } });
  await prisma.connector.deleteMany({ where: { charger: { site: { organizationId } } } });
  await prisma.charger.deleteMany({ where: { siteId } });
  await prisma.tariff.deleteMany({ where: { organizationId } });
}

// ===========================================================================

describe('pareamento', () => {
  it('o código vira token, e o código não serve duas vezes', async () => {
    const terminal = await prisma.terminal.create({
      data: { siteId, connectorId, name: 'Segunda maquininha' },
    });

    const { pairingCode } = await terminals.generatePairingCode(
      { id: 'sys', email: 'sys@teste', role: 'SUPER_ADMIN', organizationId: null },
      terminal.id,
      {},
    );

    const primeira = await comoTerminal(null, 'POST', '/terminal/pair', {
      pairingCode,
      serialNumber: 'SN-001',
      appVersion: '1.0.0',
    });

    expect(primeira.status).toBe(201);
    expect(primeira.body?.token).toMatch(/^bora_pos_/);

    // Uso único: se o mesmo código valesse de novo, quem visse a tela do painel
    // por cima do ombro parearia a própria maquininha naquele conector.
    const segunda = await comoTerminal(null, 'POST', '/terminal/pair', { pairingCode });
    expect(segunda.status).toBe(401);
  });

  it('o token em claro nunca fica no banco', async () => {
    const { token, id } = await terminalPareado();

    const gravado = await prisma.terminal.findUniqueOrThrow({ where: { id } });

    expect(gravado.tokenHash).not.toBeNull();
    expect(gravado.tokenHash).not.toContain(token);
    // O código também é consumido — nada de credencial em repouso.
    expect(gravado.pairingCode).toBeNull();
  });

  it('código expirado é recusado', async () => {
    const terminal = await prisma.terminal.create({
      data: {
        siteId,
        connectorId,
        name: 'Maquininha com código vencido',
        pairingCode: 'VENCIDO1',
        pairingExpiresAt: new Date(Date.now() - 60_000),
      },
    });

    const resposta = await comoTerminal(null, 'POST', '/terminal/pair', {
      pairingCode: 'VENCIDO1',
    });

    expect(resposta.status).toBe(401);

    const gravado = await prisma.terminal.findUniqueOrThrow({ where: { id: terminal.id } });
    expect(gravado.tokenHash).toBeNull();
  });
});

describe('acesso', () => {
  it('sem token não passa', async () => {
    const resposta = await comoTerminal(null, 'GET', '/terminal/me');
    expect(resposta.status).toBe(401);
  });

  it('token inventado não passa', async () => {
    const resposta = await comoTerminal('bora_pos_qualquercoisa', 'GET', '/terminal/me');
    expect(resposta.status).toBe(401);
  });

  /**
   * O botão de "a maquininha sumiu" precisa valer imediatamente. É por isso que
   * o token é opaco e conferido no banco a cada requisição, e não um JWT que
   * continuaria válido até expirar.
   */
  it('revogar corta o acesso na hora', async () => {
    const { token, id } = await terminalPareado();

    expect((await comoTerminal(token, 'GET', '/terminal/me')).status).toBe(200);

    await terminals.revoke(
      { id: 'sys', email: 'sys@teste', role: 'SUPER_ADMIN', organizationId: null },
      id,
      {},
    );

    expect((await comoTerminal(token, 'GET', '/terminal/me')).status).toBe(401);
  });

  it('gerar código novo invalida o token anterior', async () => {
    const { token, id } = await terminalPareado();

    await terminals.generatePairingCode(
      { id: 'sys', email: 'sys@teste', role: 'SUPER_ADMIN', organizationId: null },
      id,
      {},
    );

    expect((await comoTerminal(token, 'GET', '/terminal/me')).status).toBe(401);
  });
});

describe('contexto da tela', () => {
  it('entrega tarifa, valor a reservar e estado do conector', async () => {
    const { token } = await terminalPareado();
    await simuladorPronto();

    const resposta = await comoTerminal(token, 'GET', '/terminal/me');
    const corpo = resposta.body as Record<string, never>;

    expect(resposta.status).toBe(200);
    expect(corpo.tariff).toMatchObject({ pricePerKwhCents: 250, connectionFeeCents: 300 });
    // Teto padrão do sistema: R$ 200,00.
    expect(corpo.preAuthAmountCents).toBe(20_000);
    expect(corpo.connector).toMatchObject({ available: true });
    expect(corpo.methods).toContain('CREDIT_CARD');
  });
});

describe('recarga pela maquininha', () => {
  it('autoriza no terminal, carrega, encerra e cobra o consumido', async () => {
    const { token, id: terminalId } = await terminalPareado();
    const sim = await simuladorPronto();

    const autorizacao = await comoTerminal(token, 'POST', '/terminal/authorization', {
      providerPaymentId: 'NSU-POS-1',
      method: 'CREDIT_CARD',
      amountAuthorizedCents: 20_000,
      idempotencyKey: 'pos-e2e-1',
      cardBrand: 'VISA',
      cardLastFour: '4321',
      nsu: '998877',
    });

    expect(autorizacao.status).toBe(201);
    expect(autorizacao.body?.approved).toBe(true);

    const sessionId = autorizacao.body?.sessionId as string;

    await aguardar(
      async () => {
        const s = await prisma.chargingSession.findUnique({ where: { id: sessionId } });
        return s?.status === 'CHARGING' && sim.transactionId !== null;
      },
      { descricao: 'recarga em curso dos dois lados' },
    );

    sim.advanceMeter(2000);
    await sim.meterValues(1);
    await aguardar(async () => {
      const s = await prisma.chargingSession.findUnique({ where: { id: sessionId } });
      return (s?.energyWh ?? 0) >= 2000;
    });

    // A tela da maquininha consegue acompanhar.
    const emCurso = await comoTerminal(token, 'GET', `/terminal/sessions/${sessionId}`);
    expect(emCurso.body?.active).toBe(true);
    expect(emCurso.body?.energyWh).toBeGreaterThanOrEqual(2000);

    // O motorista aperta "encerrar" na maquininha.
    const parada = await comoTerminal(token, 'POST', `/terminal/sessions/${sessionId}/stop`, {});
    expect((parada.body?.command as { accepted: boolean }).accepted).toBe(true);

    await aguardar(
      async () => {
        const s = await prisma.chargingSession.findUnique({ where: { id: sessionId } });
        return s?.status === 'COMPLETED';
      },
      { descricao: 'sessão encerrada' },
    );

    /**
     * O ponto central deste arquivo.
     *
     * Antes da FASE 8 o fechamento de uma sessão iniciada na maquininha falhava:
     * o identificador da cobrança nasceu no equipamento e o provedor nunca o
     * tinha visto. Energia entregue e nada cobrado, sem erro visível.
     */
    const fechamento = await payments.settleSession(sessionId);
    expect(fechamento.settled).toBe(true);

    const pagamento = await prisma.payment.findFirstOrThrow({
      where: { session: { id: sessionId } },
    });

    // 2 kWh × R$ 2,50 + R$ 3,00 = R$ 8,00 — muito abaixo dos R$ 200,00 reservados.
    expect(pagamento.status).toBe('CAPTURED');
    expect(pagamento.amountCapturedCents).toBe(800);
    expect(pagamento.cardLastFour).toBe('4321');
    // O pagamento aponta para o terminal que o originou.
    expect(pagamento.terminalRefId).toBe(terminalId);
  });

  it('reenvio da mesma chave não cria segunda cobrança', async () => {
    const { token } = await terminalPareado();
    await simuladorPronto();

    const corpo = {
      providerPaymentId: 'NSU-POS-2',
      method: 'CREDIT_CARD' as const,
      amountAuthorizedCents: 15_000,
      idempotencyKey: 'pos-e2e-repetido',
    };

    const primeira = await comoTerminal(token, 'POST', '/terminal/authorization', corpo);
    const segunda = await comoTerminal(token, 'POST', '/terminal/authorization', corpo);

    expect(segunda.body?.paymentId).toBe(primeira.body?.paymentId);
    expect(await prisma.payment.count({ where: { session: { organizationId } } })).toBe(1);
  });

  it('recusa valor acima do teto configurado', async () => {
    const { token } = await terminalPareado();
    await simuladorPronto();

    const resposta = await comoTerminal(token, 'POST', '/terminal/authorization', {
      providerPaymentId: 'NSU-POS-3',
      method: 'CREDIT_CARD',
      // Acima do teto de R$ 200,00 resolvido pelo servidor.
      amountAuthorizedCents: 90_000,
      idempotencyKey: 'pos-e2e-acima-do-teto',
    });

    expect(resposta.status).toBe(400);
    expect(resposta.body?.code).toBe('AMOUNT_ABOVE_CEILING');
    expect(await prisma.payment.count({ where: { session: { organizationId } } })).toBe(0);
  });

  it('recusa número de cartão no lugar dos quatro últimos dígitos', async () => {
    const { token } = await terminalPareado();

    const resposta = await comoTerminal(token, 'POST', '/terminal/authorization', {
      providerPaymentId: 'NSU-POS-4',
      method: 'CREDIT_CARD',
      amountAuthorizedCents: 1000,
      idempotencyKey: 'pos-e2e-pan',
      cardLastFour: '4111111111111111',
    });

    // Briefing seção 12: número completo não entra, nem por engano de campo.
    expect(resposta.status).toBe(400);
  });
});

describe('risco R-32: token de terminal furtado', () => {
  /**
   * O terminal fica pendurado num poste, exposto. O que um token roubado dali
   * consegue fazer é a pergunta que define o desenho deste módulo.
   */
  it('não consegue iniciar recarga em outro conector', async () => {
    const { token } = await terminalPareado();
    await simuladorPronto();

    const outro = await prisma.connector.create({
      data: { chargerId, connectorNumber: 2, connectorType: 'CCS2' },
    });

    const resposta = await comoTerminal(token, 'POST', '/terminal/authorization', {
      providerPaymentId: 'NSU-POS-5',
      method: 'CREDIT_CARD',
      amountAuthorizedCents: 5_000,
      idempotencyKey: 'pos-e2e-outro-conector',
      // Tentativa explícita de escolher o conector pelo corpo.
      connectorId: outro.id,
    });

    // `forbidNonWhitelisted`: o campo nem é aceito. A recarga, se acontecesse,
    // seria sempre no conector do cadastro.
    expect(resposta.status).toBe(400);

    const sessoes = await prisma.chargingSession.findMany({ where: { connectorId: outro.id } });
    expect(sessoes).toHaveLength(0);
  });

  it('não consegue escolher um provedor simulado para carregar de graça', async () => {
    const { token } = await terminalPareado();
    await simuladorPronto();

    const resposta = await comoTerminal(token, 'POST', '/terminal/authorization', {
      providerPaymentId: 'NSU-POS-6',
      method: 'CREDIT_CARD',
      amountAuthorizedCents: 5_000,
      idempotencyKey: 'pos-e2e-provedor',
      provider: 'mock',
    });

    expect(resposta.status).toBe(400);
  });

  it('não consegue mexer na recarga de outro ponto de recarga', async () => {
    const { token } = await terminalPareado();
    await simuladorPronto();

    // Sessão de outro conector, que este terminal não deveria alcançar.
    const outro = await prisma.connector.create({
      data: { chargerId, connectorNumber: 3, connectorType: 'CCS2' },
    });

    const alheia = await prisma.chargingSession.create({
      data: {
        organizationId,
        siteId,
        chargerId,
        connectorId: outro.id,
        status: 'CHARGING',
        ceilingAmountCents: 20_000,
      },
    });

    expect((await comoTerminal(token, 'GET', `/terminal/sessions/${alheia.id}`)).status).toBe(403);
    expect(
      (await comoTerminal(token, 'POST', `/terminal/sessions/${alheia.id}/stop`, {})).status,
    ).toBe(403);

    const depois = await prisma.chargingSession.findUniqueOrThrow({ where: { id: alheia.id } });
    expect(depois.status).toBe('CHARGING');
  });
});
