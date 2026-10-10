/**
 * Testes das regras de negócio garantidas pelo BANCO, não pela aplicação.
 *
 * Estas regras são a última linha de defesa contra corridas: duas requisições
 * simultâneas passam por um `if (jaExiste)` em memória, mas não passam por um
 * índice único. Se algum destes testes quebrar, os riscos R-08 (webhook
 * duplicado) e a regra 11.1 (uma sessão ativa por conector) deixam de estar
 * cobertos — independentemente do que o código de aplicação faça.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ACTIVE_SESSION_STATUSES } from './index';

const databaseUrl = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL;

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

let organizationId: string;
let siteId: string;
let chargerId: string;
let connectorId: string;
let otherConnectorId: string;

beforeAll(async () => {
  // Ordem inversa das dependências, para não esbarrar em chave estrangeira.
  await prisma.chargingSession.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.connector.deleteMany();
  await prisma.charger.deleteMany();
  await prisma.site.deleteMany();
  await prisma.organization.deleteMany();

  const organization = await prisma.organization.create({
    data: { name: 'Org de Teste', slug: `teste-${Date.now()}` },
  });
  organizationId = organization.id;

  const site = await prisma.site.create({
    data: { organizationId, name: 'Site de Teste' },
  });
  siteId = site.id;

  const charger = await prisma.charger.create({
    data: { siteId, chargePointIdentity: `TEST-${Date.now()}`, name: 'Carregador de Teste' },
  });
  chargerId = charger.id;

  const connector = await prisma.connector.create({
    data: { chargerId, connectorNumber: 1 },
  });
  connectorId = connector.id;

  const other = await prisma.connector.create({
    data: { chargerId, connectorNumber: 2 },
  });
  otherConnectorId = other.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** Cria uma sessão com o mínimo necessário. */
function createSession(status: string, connector = connectorId) {
  return prisma.chargingSession.create({
    data: {
      organizationId,
      siteId,
      chargerId,
      connectorId: connector,
      status: status as never,
    },
  });
}

describe('regra 11.1 — uma sessão ativa por conector', () => {
  it('impede duas sessões ativas no mesmo conector', async () => {
    await createSession('CHARGING');

    // A segunda precisa falhar no banco, não na aplicação.
    await expect(createSession('STARTING')).rejects.toThrow();

    await prisma.chargingSession.deleteMany({ where: { connectorId } });
  });

  it.each(ACTIVE_SESSION_STATUSES)('trata %s como estado ativo', async (status) => {
    await createSession(status);
    await expect(createSession('CHARGING')).rejects.toThrow();
    await prisma.chargingSession.deleteMany({ where: { connectorId } });
  });

  it('permite sessões ativas simultâneas em conectores diferentes', async () => {
    await createSession('CHARGING', connectorId);
    await expect(createSession('CHARGING', otherConnectorId)).resolves.toBeDefined();

    await prisma.chargingSession.deleteMany();
  });

  it.each(['COMPLETED', 'CANCELLED', 'FAILED', 'EXPIRED', 'DECLINED'])(
    'libera o conector quando a sessão anterior está em %s',
    async (finalStatus) => {
      await createSession(finalStatus);
      await expect(createSession('CHARGING')).resolves.toBeDefined();

      await prisma.chargingSession.deleteMany({ where: { connectorId } });
    },
  );

  it('permite várias sessões encerradas no mesmo conector', async () => {
    await createSession('COMPLETED');
    await createSession('COMPLETED');
    await createSession('COMPLETED');

    const total = await prisma.chargingSession.count({ where: { connectorId } });
    expect(total).toBe(3);

    await prisma.chargingSession.deleteMany({ where: { connectorId } });
  });
});

describe('regra 11.2 — um pagamento não custeia duas sessões', () => {
  it('recusa a segunda sessão vinculada ao mesmo pagamento', async () => {
    const payment = await prisma.payment.create({
      data: {
        provider: 'mock',
        method: 'CREDIT_CARD',
        idempotencyKey: `idem-${Date.now()}`,
        amountAuthorizedCents: 20000,
      },
    });

    await prisma.chargingSession.create({
      data: {
        organizationId,
        siteId,
        chargerId,
        connectorId,
        paymentId: payment.id,
        status: 'COMPLETED',
      },
    });

    await expect(
      prisma.chargingSession.create({
        data: {
          organizationId,
          siteId,
          chargerId,
          connectorId: otherConnectorId,
          paymentId: payment.id,
          status: 'COMPLETED',
        },
      }),
    ).rejects.toThrow();

    await prisma.chargingSession.deleteMany();
    await prisma.payment.deleteMany();
  });
});

describe('risco R-08 — idempotência de pagamento', () => {
  it('recusa duas chaves de idempotência iguais', async () => {
    const idempotencyKey = `webhook-${Date.now()}`;

    const create = () =>
      prisma.payment.create({
        data: {
          provider: 'mock',
          method: 'PIX',
          idempotencyKey,
          amountAuthorizedCents: 3000,
        },
      });

    await create();

    // Este é o mecanismo que impede um webhook reenviado de virar dois
    // pagamentos — e, por consequência, duas recargas.
    await expect(create()).rejects.toThrow();

    await prisma.payment.deleteMany();
  });
});

describe('ADR-0005 — dinheiro em centavos inteiros', () => {
  it('armazena valores monetários como inteiros', async () => {
    const payment = await prisma.payment.create({
      data: {
        provider: 'mock',
        method: 'CREDIT_CARD',
        idempotencyKey: `centavos-${Date.now()}`,
        amountAuthorizedCents: 20000, // R$ 200,00 — o teto padrão do ADR-0008 §9
        amountCapturedCents: 6240, // R$ 62,40
      },
    });

    expect(Number.isInteger(payment.amountAuthorizedCents)).toBe(true);
    expect(Number.isInteger(payment.amountCapturedCents)).toBe(true);
    expect(payment.amountAuthorizedCents).toBe(20000);
    expect(payment.amountCapturedCents).toBe(6240);

    await prisma.payment.deleteMany();
  });

  /**
   * LACUNA CONHECIDA, verificada em 2026-07-29.
   *
   * A coluna Int garante que o valor ARMAZENADO é inteiro, mas o Prisma
   * TRUNCA frações em silêncio em vez de recusar: 1234.56 vira 1234.
   *
   * Ou seja, o banco não protege contra um cálculo em ponto flutuante vazando
   * da aplicação — ele transforma o erro em um valor errado mas plausível, que
   * é o pior resultado possível para dinheiro.
   *
   * A garantia do ADR-0005 depende, portanto, da camada de domínio. Ver
   * `assertCents` em @bora/contracts, que deve ser usado em toda fronteira que
   * receba valor monetário. A cobertura completa vem na FASE 6, junto com o
   * serviço de cálculo.
   */
  it('trunca fração em silêncio — por isso a validação precisa vir do domínio', async () => {
    const payment = await prisma.payment.create({
      data: {
        provider: 'mock',
        method: 'CREDIT_CARD',
        idempotencyKey: `fracao-${Date.now()}`,
        amountAuthorizedCents: 1234.56 as never,
      },
    });

    // Documenta o comportamento real, não o desejado.
    expect(payment.amountAuthorizedCents).toBe(1234);
    expect(Number.isInteger(payment.amountAuthorizedCents)).toBe(true);

    await prisma.payment.deleteMany();
  });
});
