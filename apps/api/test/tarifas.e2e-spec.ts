import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { TariffsService } from '../src/modules/tariffs/tariffs.service';
import { SessionPricingService } from '../src/modules/pricing/session-pricing.service';
import type { AuthenticatedUser } from '../src/modules/auth/strategies/jwt.strategy';
import { createTestApp } from './setup-app';

/**
 * Tarifação (FASE 6).
 *
 * O foco é o que só o banco revela: precedência entre tarifas, janela de
 * validade, isolamento entre organizações e — o mais importante — que alterar
 * uma tarifa hoje não muda o valor de uma recarga de ontem.
 *
 * A aritmética já está coberta, sem banco, em `packages/pricing`.
 */

let app: INestApplication;
let prisma: PrismaService;
let tariffs: TariffsService;
let pricing: SessionPricingService;

let organizationId: string;
let outraOrganizacaoId: string;
let siteId: string;
let outroSiteId: string;
let connectorId: string;

let admin: AuthenticatedUser;
let adminDaOutra: AuthenticatedUser;
let operador: AuthenticatedUser;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  tariffs = app.get(TariffsService);
  pricing = app.get(SessionPricingService);

  const org = await prisma.organization.upsert({
    where: { slug: 'tarifa-e2e' },
    update: {},
    create: { name: 'Org Tarifas E2E', slug: 'tarifa-e2e' },
  });
  organizationId = org.id;

  const outra = await prisma.organization.upsert({
    where: { slug: 'tarifa-e2e-outra' },
    update: {},
    create: { name: 'Outra Org Tarifas', slug: 'tarifa-e2e-outra' },
  });
  outraOrganizacaoId = outra.id;

  const site = await prisma.site.upsert({
    where: { organizationId_name: { organizationId, name: 'Site Tarifas A' } },
    update: {},
    create: { organizationId, name: 'Site Tarifas A' },
  });
  siteId = site.id;

  const site2 = await prisma.site.upsert({
    where: { organizationId_name: { organizationId, name: 'Site Tarifas B' } },
    update: {},
    create: { organizationId, name: 'Site Tarifas B' },
  });
  outroSiteId = site2.id;

  const charger = await prisma.charger.create({
    data: { siteId, chargePointIdentity: 'TEST-TARIFA-001', name: 'Carregador de tarifa' },
  });
  const connector = await prisma.connector.create({
    data: { chargerId: charger.id, connectorNumber: 1 },
  });
  connectorId = connector.id;

  admin = {
    id: 'u-admin',
    email: 'admin@tarifa.test',
    name: 'Admin',
    role: 'ORG_ADMIN',
    organizationId,
  } as AuthenticatedUser;

  adminDaOutra = { ...admin, id: 'u-outra', organizationId: outraOrganizacaoId };
  operador = { ...admin, id: 'u-op', role: 'OPERATOR' };
});

beforeEach(async () => {
  await prisma.chargingSession.deleteMany({ where: { organizationId } });
  await prisma.tariff.deleteMany({
    where: { organizationId: { in: [organizationId, outraOrganizacaoId] } },
  });
});

afterAll(async () => {
  await prisma.chargingSession.deleteMany({ where: { organizationId } });
  await prisma.tariff.deleteMany({
    where: { organizationId: { in: [organizationId, outraOrganizacaoId] } },
  });
  await prisma.connector.deleteMany({ where: { charger: { siteId } } });
  await prisma.charger.deleteMany({ where: { siteId } });
  await prisma.site.deleteMany({ where: { organizationId } });
  await prisma.organization.deleteMany({
    where: { id: { in: [organizationId, outraOrganizacaoId] } },
  });
  await app.close();
});

/** Tarifa de R$ 2,50/kWh com R$ 3,00 de conexão. */
const base = {
  name: 'Tarifa base',
  pricePerKwhCents: 250,
  connectionFeeCents: 300,
};

// ===========================================================================

describe('validações de cadastro', () => {
  it('recusa máximo abaixo do mínimo', async () => {
    await expect(
      tariffs.create(admin, { ...base, minimumAmountCents: 1000, maximumAmountCents: 500 }),
    ).rejects.toMatchObject({ response: { code: 'TARIFF_MAX_BELOW_MIN' } });
  });

  it('recusa tarifa inteiramente zerada', async () => {
    // Uma tarifa que não cobra nada é quase sempre erro de preenchimento, e o
    // efeito só aparece no fechamento do mês.
    await expect(
      tariffs.create(admin, { name: 'Grátis', pricePerKwhCents: 0 }),
    ).rejects.toMatchObject({ response: { code: 'TARIFF_ALL_ZERO' } });
  });

  it('aceita tarifa que só cobra ociosidade', async () => {
    // Um estacionamento que não cobra a energia, só a permanência.
    const t = await tariffs.create(admin, {
      name: 'Só ociosidade',
      pricePerKwhCents: 0,
      idleFeePerMinuteCents: 100,
    });

    expect(t.idleFeePerMinuteCents).toBe(100);
  });

  it('recusa validade que termina antes de começar', async () => {
    await expect(
      tariffs.create(admin, {
        ...base,
        validFrom: '2026-08-01T00:00:00.000Z',
        validUntil: '2026-07-01T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({ response: { code: 'TARIFF_INVALID_PERIOD' } });
  });

  it('recusa estabelecimento de outra organização', async () => {
    await expect(tariffs.create(adminDaOutra, { ...base, siteId })).rejects.toMatchObject({
      response: { code: expect.stringMatching(/FORBIDDEN|ORGANIZATION/) },
    });
  });
});

describe('isolamento entre organizações', () => {
  it('a listagem não mostra tarifa de outra organização', async () => {
    await tariffs.create(admin, base);
    await prisma.tariff.create({
      data: { organizationId: outraOrganizacaoId, name: 'Tarifa alheia', pricePerKwhCents: 999 },
    });

    const minhas = await tariffs.list(admin, { page: 1, pageSize: 25, skip: 0 });

    expect(minhas.items).toHaveLength(1);
    expect(minhas.items[0].name).toBe('Tarifa base');
  });

  it('não é possível ler tarifa de outra organização pelo id', async () => {
    const alheia = await prisma.tariff.create({
      data: { organizationId: outraOrganizacaoId, name: 'Tarifa alheia', pricePerKwhCents: 999 },
    });

    await expect(tariffs.get(admin, alheia.id)).rejects.toThrow();
  });
});

describe('precedência e validade', () => {
  it('a tarifa do estabelecimento vence a da organização', async () => {
    await tariffs.create(admin, { ...base, name: 'Geral', pricePerKwhCents: 250 });
    await tariffs.create(admin, { ...base, name: 'Do site', pricePerKwhCents: 180, siteId });

    const termos = await pricing.resolveTerms({ connectorId });

    expect(termos.snapshot.name).toBe('Do site');
    expect(termos.snapshot.pricePerKwhCents).toBe(180);
  });

  it('a tarifa de OUTRO estabelecimento nunca é usada', async () => {
    await tariffs.create(admin, { ...base, name: 'Geral', pricePerKwhCents: 250 });
    await tariffs.create(admin, {
      ...base,
      name: 'De outro site',
      pricePerKwhCents: 10,
      siteId: outroSiteId,
    });

    const termos = await pricing.resolveTerms({ connectorId });

    expect(termos.snapshot.name).toBe('Geral');
  });

  it('tarifa fora da janela de validade não é aplicada', async () => {
    await tariffs.create(admin, {
      ...base,
      name: 'Vencida',
      validFrom: '2020-01-01T00:00:00.000Z',
      validUntil: '2020-12-31T00:00:00.000Z',
    });

    const termos = await pricing.resolveTerms({ connectorId });

    // Sem tarifa aplicável, o sistema não inventa preço: zera e deixa visível.
    expect(termos.snapshot.tariffId).toBeNull();
    expect(termos.snapshot.pricePerKwhCents).toBe(0);
  });

  it('tarifa que só começa no futuro ainda não é aplicada', async () => {
    const daqui = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    const t = await tariffs.create(admin, {
      ...base,
      name: 'Do mês que vem',
      validFrom: daqui.toISOString(),
    });

    // Aparece como ativa no painel...
    expect(t.active).toBe(true);
    // ...mas a distinção existe justamente para não confundir cadastrada com valendo.
    expect(t.inEffect).toBe(false);

    const termos = await pricing.resolveTerms({ connectorId });
    expect(termos.snapshot.tariffId).toBeNull();
  });

  it('tarifa desativada deixa de ser aplicada, mas continua existindo', async () => {
    const t = await tariffs.create(admin, base);
    await tariffs.deactivate(admin, t.id);

    const termos = await pricing.resolveTerms({ connectorId });
    expect(termos.snapshot.tariffId).toBeNull();

    // O registro segue no banco: o histórico financeiro precisa dele.
    const noBanco = await prisma.tariff.findUnique({ where: { id: t.id } });
    expect(noBanco).not.toBeNull();
    expect(noBanco?.status).toBe('INACTIVE');
  });

  it('entre duas tarifas gerais válidas, vence a de início mais recente', async () => {
    await tariffs.create(admin, {
      ...base,
      name: 'Antiga',
      pricePerKwhCents: 200,
      validFrom: '2026-01-01T00:00:00.000Z',
    });
    await tariffs.create(admin, {
      ...base,
      name: 'Nova',
      pricePerKwhCents: 300,
      validFrom: '2026-06-01T00:00:00.000Z',
    });

    const termos = await pricing.resolveTerms({ connectorId });
    expect(termos.snapshot.name).toBe('Nova');
  });
});

describe('o passado não muda', () => {
  /**
   * A garantia central da FASE 6. Sem ela, corrigir um preço mudaria
   * retroativamente o valor de recargas já cobradas.
   */
  it('alterar a tarifa não altera o valor de uma recarga já feita', async () => {
    const t = await tariffs.create(admin, base);
    const termos = await pricing.resolveTerms({ connectorId });

    const sessao = await prisma.chargingSession.create({
      data: {
        organizationId,
        siteId,
        chargerId: (await prisma.connector.findUniqueOrThrow({ where: { id: connectorId } }))
          .chargerId,
        connectorId,
        status: 'COMPLETED',
        tariffId: t.id,
        tariffSnapshot: termos.snapshot as never,
        energyWh: 10_000,
        durationSeconds: 1800,
        stoppedAt: new Date(),
        ceilingAmountCents: 20_000,
      },
    });

    const antes = pricing.finalAmount(sessao);
    // 10 kWh × R$ 2,50 + R$ 3,00 = R$ 28,00
    expect(antes?.totalCents).toBe(2800);

    // O preço dobra.
    await tariffs.update(admin, t.id, { pricePerKwhCents: 500 });

    const depois = pricing.finalAmount(
      await prisma.chargingSession.findUniqueOrThrow({ where: { id: sessao.id } }),
    );

    expect(depois?.totalCents).toBe(2800);
  });

  it('a próxima recarga já usa o preço novo', async () => {
    const t = await tariffs.create(admin, base);
    await tariffs.update(admin, t.id, { pricePerKwhCents: 500 });

    const termos = await pricing.resolveTerms({ connectorId });
    expect(termos.snapshot.pricePerKwhCents).toBe(500);
  });
});

describe('simulação de preço', () => {
  it('usa a mesma conta do fechamento real', async () => {
    const t = await tariffs.create(admin, {
      ...base,
      pricePerMinuteCents: 50,
      idleFeePerMinuteCents: 100,
    });

    const r = await tariffs.simulate(admin, t.id, {
      energyWh: 10_000,
      durationSeconds: 3600,
      idleSeconds: 1200,
    });

    // R$ 3,00 conexão + R$ 25,00 energia + R$ 20,00 (40 min) + R$ 20,00 (20 min ociosos)
    expect(r.connectionFeeCents).toBe(300);
    expect(r.energyCents).toBe(2500);
    expect(r.timeCents).toBe(2000);
    expect(r.idleCents).toBe(2000);
    expect(r.totalCents).toBe(6800);
  });

  it('mostra quando o teto financeiro corta o valor', async () => {
    const t = await tariffs.create(admin, base);

    const r = await tariffs.simulate(admin, t.id, {
      energyWh: 100_000,
      durationSeconds: 0,
      ceilingAmountCents: 20_000,
    });

    expect(r.ceilingApplied).toBe(true);
    expect(r.totalCents).toBe(20_000);
  });

  it('o operador consegue simular, mesmo sem poder alterar a tarifa', async () => {
    const t = await tariffs.create(admin, base);

    // Simular é leitura: quem opera precisa saber o preço que está praticando.
    await expect(
      tariffs.simulate(operador, t.id, { energyWh: 1000, durationSeconds: 60 }),
    ).resolves.toBeDefined();
  });
});
