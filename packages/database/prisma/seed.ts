/**
 * Seed de desenvolvimento.
 *
 * Cria os quatro perfis pedidos no briefing (FASE 1) e um cenário mínimo:
 * uma organização, um estabelecimento, um carregador simulado com dois
 * conectores e uma tarifa válida.
 *
 * É idempotente — pode rodar quantas vezes quiser sem duplicar nada.
 *
 * Não roda em produção: as senhas vêm de variável de ambiente e são de teste.
 */
import { hash } from '@node-rs/argon2';
import { PrismaClient, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

/** Argon2id com parâmetros conscientes, não os padrões da biblioteca. */
const ARGON2_OPTIONS = {
  memoryCost: 19456, // 19 MiB — recomendação OWASP
  timeCost: 2,
  parallelism: 1,
} as const;

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('O seed não pode ser executado em produção.');
  }

  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password || password.includes('CHANGE_ME')) {
    throw new Error(
      'Defina SEED_ADMIN_PASSWORD no .env com uma senha real de desenvolvimento ' +
        '(o valor de exemplo não é aceito).',
    );
  }

  const passwordHash = await hash(password, ARGON2_OPTIONS);

  // ---------------------------------------------------------------------
  // Organização e estabelecimento
  // ---------------------------------------------------------------------
  const organization = await prisma.organization.upsert({
    where: { slug: 'sonare' },
    update: {},
    create: {
      name: 'Sonare Engenharia',
      slug: 'sonare',
      // Nulo de propósito: herda o teto da variável de ambiente (ADR-0008 §9).
      preAuthCeilingCents: null,
    },
  });

  const site = await prisma.site.upsert({
    where: { organizationId_name: { organizationId: organization.id, name: 'Sede Sonare' } },
    update: {},
    create: {
      organizationId: organization.id,
      name: 'Sede Sonare',
      legalName: 'Sonare Engenharia Ltda.',
      address: 'Endereço de desenvolvimento',
      city: 'Cuiabá',
      state: 'MT',
      timezone: 'America/Cuiaba',
    },
  });

  // ---------------------------------------------------------------------
  // Usuários — os quatro perfis do briefing
  // ---------------------------------------------------------------------
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@sonare.com.br';

  const users = [
    {
      email: adminEmail,
      name: 'Administrador Global',
      role: UserRole.SUPER_ADMIN,
      organizationId: null, // enxerga todas as organizações
    },
    {
      email: 'gestor@sonare.com.br',
      name: 'Administrador do Estabelecimento',
      role: UserRole.ORG_ADMIN,
      organizationId: organization.id,
    },
    {
      email: 'operador@sonare.com.br',
      name: 'Operador',
      role: UserRole.OPERATOR,
      organizationId: organization.id,
    },
    {
      email: 'visualizador@sonare.com.br',
      name: 'Visualizador',
      role: UserRole.VIEWER,
      organizationId: organization.id,
    },
  ];

  for (const user of users) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: { name: user.name, role: user.role, organizationId: user.organizationId },
      create: { ...user, passwordHash },
    });
  }

  // ---------------------------------------------------------------------
  // Carregador simulado
  //
  // Representa o simulador OCPP da FASE 2, não o WEMOB real. O equipamento
  // real só é cadastrado na FASE 4, com autorização explícita.
  // ---------------------------------------------------------------------
  const charger = await prisma.charger.upsert({
    where: { chargePointIdentity: 'SIM-001' },
    update: {},
    create: {
      siteId: site.id,
      chargePointIdentity: 'SIM-001',
      name: 'Simulador 001',
      manufacturer: 'Borá Carregar',
      model: 'Simulador OCPP 1.6J',
      protocolVersion: 'ocpp1.6',
      address: 'Ambiente de desenvolvimento',
    },
  });

  for (const [index, type] of ['CCS2', 'CCS2'].entries()) {
    const connectorNumber = index + 1;
    await prisma.connector.upsert({
      where: { chargerId_connectorNumber: { chargerId: charger.id, connectorNumber } },
      update: {},
      create: {
        chargerId: charger.id,
        connectorNumber,
        connectorType: type,
        ratedPowerKw: 30,
      },
    });
  }

  // ---------------------------------------------------------------------
  // Tarifa
  //
  // Valores em centavos inteiros (ADR-0005). R$ 2,20/kWh + R$ 3,00 de conexão.
  // ---------------------------------------------------------------------
  const existingTariff = await prisma.tariff.findFirst({
    where: { organizationId: organization.id, name: 'Tarifa padrão (desenvolvimento)' },
  });

  if (!existingTariff) {
    await prisma.tariff.create({
      data: {
        organizationId: organization.id,
        siteId: site.id,
        name: 'Tarifa padrão (desenvolvimento)',
        pricePerKwhCents: 220,
        connectionFeeCents: 300,
        pricePerMinuteCents: 0,
        minimumAmountCents: 500,
        maximumAmountCents: null,
      },
    });
  }

  console.log('Seed concluído.');
  console.log(`  Organização: ${organization.name} (${organization.slug})`);
  console.log(`  Estabelecimento: ${site.name}`);
  console.log(`  Carregador: ${charger.chargePointIdentity}`);
  console.log('  Usuários:');
  for (const user of users) {
    console.log(`    ${user.role.padEnd(12)} ${user.email}`);
  }
  console.log('  Senha: a definida em SEED_ADMIN_PASSWORD');
}

main()
  .catch((error: unknown) => {
    console.error('Falha no seed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
