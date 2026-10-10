import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { hash } from '@node-rs/argon2';
import { OcppSimulator } from '@bora/ocpp-simulator';
import { PrismaService } from '../src/prisma/prisma.service';
import { OcppGateway } from '../src/modules/ocpp/ocpp.gateway';
import { createTestApp } from './setup-app';

/**
 * Testes das rotas do painel (FASE 3).
 *
 * O foco é o que não dá para verificar clicando: **isolamento entre
 * organizações** e **controle por papel**. Um operador de um hotel enxergar as
 * sessões de outro é o defeito mais caro que este módulo pode ter, e não é
 * visível numa inspeção manual com um único estabelecimento.
 */

const SENHA = 'senha-de-teste-123';
const ARGON2 = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

let app: INestApplication;
let prisma: PrismaService;
let baseUrl: string;

/** Duas organizações independentes, para provar que não se veem. */
const orgA = { id: '', siteId: '', chargerId: '', connectorId: '' };
const orgB = { id: '', siteId: '', chargerId: '', connectorId: '' };

const usuarios = {
  global: 'painel-global@sonare.com.br',
  adminA: 'painel-admin-a@sonare.com.br',
  operadorA: 'painel-operador-a@sonare.com.br',
  visualizadorA: 'painel-visualizador-a@sonare.com.br',
  adminB: 'painel-admin-b@sonare.com.br',
};

const IDENTITY_A = 'PAINEL-A-001';
const IDENTITY_B = 'PAINEL-B-001';

const simuladores: OcppSimulator[] = [];

async function token(email: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password: SENHA })
    .expect(200);

  return res.body.accessToken as string;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function aguardar(
  condicao: () => Promise<boolean> | boolean,
  { timeoutMs = 8000, descricao = 'condição' } = {},
): Promise<void> {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    if (await condicao()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`tempo esgotado aguardando: ${descricao}`);
}

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);

  await app.listen(0);
  app.get(OcppGateway).attach(app.getHttpServer() as Server);

  const endereco = (app.getHttpServer() as Server).address();
  const porta = typeof endereco === 'object' && endereco ? endereco.port : 0;
  baseUrl = `ws://127.0.0.1:${porta}/ocpp`;

  await limpar();

  const passwordHash = await hash(SENHA, ARGON2);

  for (const [slug, alvo, identity] of [
    ['painel-org-a', orgA, IDENTITY_A],
    ['painel-org-b', orgB, IDENTITY_B],
  ] as const) {
    const org = await prisma.organization.create({
      data: { name: `Org ${slug}`, slug },
    });
    alvo.id = org.id;

    const site = await prisma.site.create({
      data: { organizationId: org.id, name: `Site ${slug}`, city: 'Cuiabá', state: 'MT' },
    });
    alvo.siteId = site.id;

    const charger = await prisma.charger.create({
      data: { siteId: site.id, chargePointIdentity: identity, name: `Carregador ${slug}` },
    });
    alvo.chargerId = charger.id;

    const connector = await prisma.connector.create({
      data: { chargerId: charger.id, connectorNumber: 1, connectorType: 'CCS2', ratedPowerKw: 30 },
    });
    alvo.connectorId = connector.id;
  }

  await prisma.user.createMany({
    data: [
      { email: usuarios.global, name: 'Global', passwordHash, role: 'SUPER_ADMIN' },
      {
        email: usuarios.adminA,
        name: 'Admin A',
        passwordHash,
        role: 'ORG_ADMIN',
        organizationId: orgA.id,
      },
      {
        email: usuarios.operadorA,
        name: 'Operador A',
        passwordHash,
        role: 'OPERATOR',
        organizationId: orgA.id,
      },
      {
        email: usuarios.visualizadorA,
        name: 'Visualizador A',
        passwordHash,
        role: 'VIEWER',
        organizationId: orgA.id,
      },
      {
        email: usuarios.adminB,
        name: 'Admin B',
        passwordHash,
        role: 'ORG_ADMIN',
        organizationId: orgB.id,
      },
    ],
  });
});

beforeEach(async () => {
  await prisma.chargingSession.deleteMany({
    where: { organizationId: { in: [orgA.id, orgB.id] } },
  });
});

afterAll(async () => {
  await Promise.all(simuladores.splice(0).map((s) => s.disconnect().catch(() => undefined)));
  await limpar();
  await app.close();
});

async function limpar() {
  const orgs = { slug: { in: ['painel-org-a', 'painel-org-b'] } };

  await prisma.auditLog.deleteMany({ where: { user: { email: { in: Object.values(usuarios) } } } });
  await prisma.meterValue.deleteMany({ where: { charger: { site: { organization: orgs } } } });
  await prisma.chargingSession.deleteMany({ where: { organization: orgs } });
  await prisma.ocppMessage.deleteMany({ where: { charger: { site: { organization: orgs } } } });
  await prisma.connector.deleteMany({ where: { charger: { site: { organization: orgs } } } });
  await prisma.charger.deleteMany({ where: { site: { organization: orgs } } });
  await prisma.site.deleteMany({ where: { organization: orgs } });
  await prisma.user.deleteMany({ where: { email: { in: Object.values(usuarios) } } });
  await prisma.organization.deleteMany({ where: orgs });
}

// ===========================================================================

describe('Paginação nas listagens', () => {
  /**
   * Regressão de um defeito real: o controller tinha dois `@Query()` no mesmo
   * endpoint, e cada DTO validava a query INTEIRA de forma independente. Com
   * `forbidNonWhitelisted`, `?pageSize=50` era rejeitado com 400 — a listagem
   * do painel não abria. Descoberto testando no navegador, não na API.
   */
  it.each([
    '/api/v1/chargers?page=1&pageSize=50',
    '/api/v1/sessions?page=1&pageSize=50',
    '/api/v1/sessions?pageSize=50&activeOnly=true',
    '/api/v1/sites?page=1&pageSize=50',
  ])('aceita paginação em %s', async (url) => {
    const t = await token(usuarios.adminA);
    const res = await request(app.getHttpServer()).get(url).set(auth(t)).expect(200);

    expect(res.body).toHaveProperty('items');
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('totalPages');
  });

  it('recusa pageSize acima do teto', async () => {
    const t = await token(usuarios.adminA);
    await request(app.getHttpServer())
      .get('/api/v1/chargers?pageSize=5000')
      .set(auth(t))
      .expect(400);
  });
});

describe('Isolamento entre organizações', () => {
  it('cada administrador vê apenas o próprio estabelecimento', async () => {
    const tA = await token(usuarios.adminA);
    const tB = await token(usuarios.adminB);

    const resA = await request(app.getHttpServer()).get('/api/v1/sites').set(auth(tA)).expect(200);
    const resB = await request(app.getHttpServer()).get('/api/v1/sites').set(auth(tB)).expect(200);

    expect(resA.body.items.map((s: { id: string }) => s.id)).toEqual([orgA.siteId]);
    expect(resB.body.items.map((s: { id: string }) => s.id)).toEqual([orgB.siteId]);
  });

  it('cada organização vê apenas os próprios carregadores', async () => {
    const tA = await token(usuarios.adminA);

    const res = await request(app.getHttpServer())
      .get('/api/v1/chargers')
      .set(auth(tA))
      .expect(200);

    const identities = res.body.items.map(
      (c: { chargePointIdentity: string }) => c.chargePointIdentity,
    );
    expect(identities).toContain(IDENTITY_A);
    expect(identities).not.toContain(IDENTITY_B);
  });

  it('recusa acesso ao carregador de outra organização', async () => {
    const tA = await token(usuarios.adminA);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/chargers/${orgB.chargerId}`)
      .set(auth(tA))
      .expect(403);

    expect(res.body.code).toBe('WRONG_ORGANIZATION');
  });

  it('recusa ver mensagens OCPP de carregador alheio', async () => {
    const tA = await token(usuarios.adminA);

    await request(app.getHttpServer())
      .get(`/api/v1/chargers/${orgB.chargerId}/messages`)
      .set(auth(tA))
      .expect(403);
  });

  it('recusa iniciar recarga em conector de outra organização', async () => {
    const tA = await token(usuarios.operadorA);

    const res = await request(app.getHttpServer())
      .post('/api/v1/sessions/manual-start')
      .set(auth(tA))
      .send({ connectorId: orgB.connectorId })
      .expect(403);

    expect(res.body.code).toBe('WRONG_ORGANIZATION');
  });

  it('recusa parar sessão de outra organização', async () => {
    const sessao = await prisma.chargingSession.create({
      data: {
        organizationId: orgB.id,
        siteId: orgB.siteId,
        chargerId: orgB.chargerId,
        connectorId: orgB.connectorId,
        status: 'CHARGING',
        ocppTransactionId: 987_654,
      },
    });

    const tA = await token(usuarios.operadorA);

    await request(app.getHttpServer())
      .post(`/api/v1/sessions/${sessao.id}/stop`)
      .set(auth(tA))
      .expect(403);
  });

  it('sessões de outra organização não aparecem na listagem', async () => {
    await prisma.chargingSession.create({
      data: {
        organizationId: orgB.id,
        siteId: orgB.siteId,
        chargerId: orgB.chargerId,
        connectorId: orgB.connectorId,
        status: 'COMPLETED',
        energyWh: 12345,
      },
    });

    const tA = await token(usuarios.adminA);
    const res = await request(app.getHttpServer())
      .get('/api/v1/sessions')
      .set(auth(tA))
      .expect(200);

    expect(res.body.items).toHaveLength(0);
  });

  it('a visão geral não soma dados de outra organização', async () => {
    await prisma.chargingSession.create({
      data: {
        organizationId: orgB.id,
        siteId: orgB.siteId,
        chargerId: orgB.chargerId,
        connectorId: orgB.connectorId,
        status: 'COMPLETED',
        stoppedAt: new Date(),
        energyWh: 50_000,
        finalAmountCents: 11_000,
      },
    });

    const tA = await token(usuarios.adminA);
    const res = await request(app.getHttpServer())
      .get('/api/v1/dashboard/overview')
      .set(auth(tA))
      .expect(200);

    // Energia e receita da org B não podem vazar para o painel da org A.
    expect(res.body.today.energyWh).toBe(0);
    expect(res.body.today.receivedCents).toBe(0);
    expect(res.body.chargers.total).toBe(1);
  });

  it('o administrador global enxerga todas as organizações', async () => {
    const tGlobal = await token(usuarios.global);

    const res = await request(app.getHttpServer())
      .get('/api/v1/chargers')
      .set(auth(tGlobal))
      .expect(200);

    const identities = res.body.items.map(
      (c: { chargePointIdentity: string }) => c.chargePointIdentity,
    );
    expect(identities).toContain(IDENTITY_A);
    expect(identities).toContain(IDENTITY_B);
  });

  it('o administrador global precisa informar a organização ao criar', async () => {
    const tGlobal = await token(usuarios.global);

    const res = await request(app.getHttpServer())
      .post('/api/v1/sites')
      .set(auth(tGlobal))
      .send({ name: 'Sem organização' })
      .expect(403);

    expect(res.body.code).toBe('ORGANIZATION_REQUIRED');
  });

  /**
   * Confiar no `organizationId` do corpo permitiria criar recurso no
   * estabelecimento alheio. O valor do cliente é ignorado para papéis não-globais.
   */
  it('ignora a organização informada no corpo por quem não é global', async () => {
    const tA = await token(usuarios.adminA);

    const res = await request(app.getHttpServer())
      .post('/api/v1/sites')
      .set(auth(tA))
      .send({ name: 'Tentativa de invasão', organizationId: orgB.id })
      .expect(201);

    expect(res.body.organizationId).toBe(orgA.id);

    await prisma.site.delete({ where: { id: res.body.id } });
  });
});

describe('Controle por papel', () => {
  it('visualizador não inicia recarga', async () => {
    const t = await token(usuarios.visualizadorA);

    const res = await request(app.getHttpServer())
      .post('/api/v1/sessions/manual-start')
      .set(auth(t))
      .send({ connectorId: orgA.connectorId })
      .expect(403);

    expect(res.body.code).toBe('INSUFFICIENT_ROLE');
    // Mensagem em português, com o nome do perfil (seção 14).
    expect(res.body.message).toContain('Operador');
  });

  it('visualizador não bloqueia carregador', async () => {
    const t = await token(usuarios.visualizadorA);

    await request(app.getHttpServer())
      .patch(`/api/v1/chargers/${orgA.chargerId}/operational-status`)
      .set(auth(t))
      .send({ status: 'BLOCKED' })
      .expect(403);
  });

  it('visualizador lê carregadores e sessões', async () => {
    const t = await token(usuarios.visualizadorA);

    await request(app.getHttpServer()).get('/api/v1/chargers').set(auth(t)).expect(200);
    await request(app.getHttpServer()).get('/api/v1/sessions').set(auth(t)).expect(200);
    await request(app.getHttpServer()).get('/api/v1/dashboard/overview').set(auth(t)).expect(200);
  });

  it('operador não cadastra carregador — é ato de administração', async () => {
    const t = await token(usuarios.operadorA);

    await request(app.getHttpServer())
      .post('/api/v1/chargers')
      .set(auth(t))
      .send({ siteId: orgA.siteId, chargePointIdentity: 'NOVO-001', name: 'Novo' })
      .expect(403);
  });

  it('operador bloqueia e libera carregador', async () => {
    const t = await token(usuarios.operadorA);

    const bloqueado = await request(app.getHttpServer())
      .patch(`/api/v1/chargers/${orgA.chargerId}/operational-status`)
      .set(auth(t))
      .send({ status: 'BLOCKED', reason: 'teste' })
      .expect(200);

    expect(bloqueado.body.operationalStatus).toBe('BLOCKED');
    expect(bloqueado.body.operationalStatusLabel).toBe('Bloqueado');

    const liberado = await request(app.getHttpServer())
      .patch(`/api/v1/chargers/${orgA.chargerId}/operational-status`)
      .set(auth(t))
      .send({ status: 'AVAILABLE' })
      .expect(200);

    expect(liberado.body.operationalStatus).toBe('AVAILABLE');
  });
});

describe('Cadastro de carregador', () => {
  it('cria com conectores e devolve a credencial uma única vez', async () => {
    const t = await token(usuarios.adminA);

    const res = await request(app.getHttpServer())
      .post('/api/v1/chargers')
      .set(auth(t))
      .send({
        siteId: orgA.siteId,
        chargePointIdentity: 'PAINEL-NOVO-001',
        name: 'Carregador novo',
        generateCredential: true,
        connectors: [
          { connectorNumber: 1, connectorType: 'CCS2', ratedPowerKw: 30 },
          { connectorNumber: 2, connectorType: 'CCS2', ratedPowerKw: 30 },
        ],
      })
      .expect(201);

    expect(res.body.credential).toBeTruthy();
    expect(res.body.hasCredentials).toBe(true);
    expect(res.body.connectors).toHaveLength(2);
    // A URL a configurar no equipamento vem pronta.
    expect(res.body.ocppUrl).toContain('/ocpp/PAINEL-NOVO-001');

    // Buscar de novo NÃO devolve a credencial: guardamos só o hash.
    const detalhe = await request(app.getHttpServer())
      .get(`/api/v1/chargers/${res.body.id}`)
      .set(auth(t))
      .expect(200);

    expect(detalhe.body).not.toHaveProperty('credential');
    expect(detalhe.body.hasCredentials).toBe(true);

    await prisma.charger.delete({ where: { id: res.body.id } });
  });

  it('recusa identity duplicada', async () => {
    const t = await token(usuarios.adminA);

    const res = await request(app.getHttpServer())
      .post('/api/v1/chargers')
      .set(auth(t))
      .send({ siteId: orgA.siteId, chargePointIdentity: IDENTITY_A, name: 'Duplicado' })
      .expect(409);

    expect(res.body.code).toBe('DUPLICATE');
  });

  it('recusa identity com caractere que quebraria a URL', async () => {
    const t = await token(usuarios.adminA);

    await request(app.getHttpServer())
      .post('/api/v1/chargers')
      .set(auth(t))
      .send({ siteId: orgA.siteId, chargePointIdentity: 'com espaço/e barra', name: 'Ruim' })
      .expect(400);
  });

  it('rotaciona a credencial, invalidando a anterior', async () => {
    const t = await token(usuarios.adminA);

    const primeira = await request(app.getHttpServer())
      .post(`/api/v1/chargers/${orgA.chargerId}/credential`)
      .set(auth(t))
      .expect(201);

    const segunda = await request(app.getHttpServer())
      .post(`/api/v1/chargers/${orgA.chargerId}/credential`)
      .set(auth(t))
      .expect(201);

    expect(primeira.body.credential).not.toBe(segunda.body.credential);

    // A credencial antiga não conecta mais.
    const antigo = new OcppSimulator({
      url: baseUrl,
      chargePointIdentity: IDENTITY_A,
      password: primeira.body.credential,
      autoReconnect: false,
    });
    simuladores.push(antigo);

    await expect(antigo.connect()).rejects.toThrow(/401|recusou/);

    // A nova conecta.
    const novo = new OcppSimulator({
      url: baseUrl,
      chargePointIdentity: IDENTITY_A,
      password: segunda.body.credential,
      autoReconnect: false,
    });
    simuladores.push(novo);

    await novo.connect();
    expect(novo.connected).toBe(true);
    await novo.disconnect();

    // Devolve o carregador ao estado sem credencial para os demais testes.
    await prisma.charger.update({
      where: { id: orgA.chargerId },
      data: { credentialsHash: null },
    });
  });
});

describe('Hierarquia do teto de pré-autorização (ADR-0008 §9)', () => {
  it('cai no padrão do sistema quando ninguém define', async () => {
    const t = await token(usuarios.adminA);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/chargers/${orgA.chargerId}`)
      .set(auth(t))
      .expect(200);

    // R$ 200,00 em centavos inteiros.
    expect(res.body.effectivePreAuthCeilingCents).toBe(20000);
    expect(res.body.preAuthCeilingSource).toBe('padrão do sistema');
  });

  it('o estabelecimento sobrescreve o padrão, e o carregador sobrescreve o estabelecimento', async () => {
    const t = await token(usuarios.adminA);

    await prisma.site.update({
      where: { id: orgA.siteId },
      data: { preAuthCeilingCents: 15000 },
    });

    let res = await request(app.getHttpServer())
      .get(`/api/v1/chargers/${orgA.chargerId}`)
      .set(auth(t))
      .expect(200);

    expect(res.body.effectivePreAuthCeilingCents).toBe(15000);
    expect(res.body.preAuthCeilingSource).toBe('estabelecimento');

    await prisma.charger.update({
      where: { id: orgA.chargerId },
      data: { preAuthCeilingCents: 5000 },
    });

    res = await request(app.getHttpServer())
      .get(`/api/v1/chargers/${orgA.chargerId}`)
      .set(auth(t))
      .expect(200);

    expect(res.body.effectivePreAuthCeilingCents).toBe(5000);
    expect(res.body.preAuthCeilingSource).toBe('carregador');

    await prisma.site.update({ where: { id: orgA.siteId }, data: { preAuthCeilingCents: null } });
    await prisma.charger.update({
      where: { id: orgA.chargerId },
      data: { preAuthCeilingCents: null },
    });
  });

  it('recusa teto fracionário — dinheiro é centavo inteiro (ADR-0005)', async () => {
    const t = await token(usuarios.adminA);

    await request(app.getHttpServer())
      .post('/api/v1/sites')
      .set(auth(t))
      .send({ name: 'Teto quebrado', preAuthCeilingCents: 199.99 })
      .expect(400);
  });
});

describe('Operação manual com o simulador', () => {
  it('inicia, acompanha e encerra pelo painel', async () => {
    const sim = new OcppSimulator({
      url: baseUrl,
      chargePointIdentity: IDENTITY_A,
      meterIntervalMs: 150,
      autoReconnect: false,
    });
    simuladores.push(sim);

    await sim.connect();
    await sim.bootNotification();
    await sim.statusNotification(1, 'Available');
    await sim.plugIn(1);

    const t = await token(usuarios.operadorA);

    const inicio = await request(app.getHttpServer())
      .post('/api/v1/sessions/manual-start')
      .set(auth(t))
      .send({ connectorId: orgA.connectorId })
      .expect(201);

    expect(inicio.body.command.accepted).toBe(true);
    const sessionId = inicio.body.session.id as string;

    // Sessão manual não tem pagamento vinculado.
    expect(inicio.body.session.payment).toBeNull();

    await aguardar(
      async () => {
        const s = await prisma.chargingSession.findUnique({ where: { id: sessionId } });
        return s?.status === 'CHARGING' && (s.energyWh ?? 0) > 0;
      },
      { descricao: 'sessão carregando com energia' },
    );

    const detalhe = await request(app.getHttpServer())
      .get(`/api/v1/sessions/${sessionId}`)
      .set(auth(t))
      .expect(200);

    expect(detalhe.body.statusLabel).toBe('Carregando');
    expect(detalhe.body.isActive).toBe(true);
    // Duração calculada agora, não só quando a sessão fecha.
    expect(detalhe.body.durationSeconds).toBeGreaterThanOrEqual(0);
    expect(detalhe.body.ceilingAmountCents).toBe(20000);

    // A linha do tempo mostra onde a sessão está (seção 13).
    const feitos = detalhe.body.timeline.filter((p: { done: boolean }) => p.done);
    expect(feitos.map((p: { key: string }) => p.key)).toContain('started');
    expect(feitos.map((p: { key: string }) => p.key)).toContain('measured');
    // Valor calculado ainda não: é FASE 6.
    const valor = detalhe.body.timeline.find((p: { key: string }) => p.key === 'amount');
    expect(valor.done).toBe(false);

    const leituras = await request(app.getHttpServer())
      .get(`/api/v1/sessions/${sessionId}/meter-values`)
      .set(auth(t))
      .expect(200);

    expect(leituras.body.length).toBeGreaterThan(0);
    // Energia relativa ao início, não a leitura absoluta do medidor.
    expect(leituras.body[0].energyWh).toBeLessThan(10_000);

    const parada = await request(app.getHttpServer())
      .post(`/api/v1/sessions/${sessionId}/stop`)
      .set(auth(t))
      .expect(201);

    expect(parada.body.command.accepted).toBe(true);

    await aguardar(
      async () => {
        const s = await prisma.chargingSession.findUnique({ where: { id: sessionId } });
        return s?.status === 'COMPLETED';
      },
      { descricao: 'sessão concluída' },
    );

    const final = await request(app.getHttpServer())
      .get(`/api/v1/sessions/${sessionId}`)
      .set(auth(t))
      .expect(200);

    expect(final.body.statusLabel).toBe('Concluída');
    expect(final.body.stopReasonLabel).toBe('Encerrada pelo painel');
    expect(final.body.energyWh).toBeGreaterThan(0);

    await sim.disconnect();
  });

  /**
   * Regressão de um defeito real: quando o comando falhava, a sessão ficava em
   * `PAYMENT_APPROVED` para sempre, ocupando o conector pelo índice da regra
   * 11.1 — o operador não conseguia tentar de novo por nenhum caminho do painel.
   */
  it('início com carregador offline não deixa o conector travado', async () => {
    const t = await token(usuarios.operadorA);

    for (let i = 0; i < 3; i += 1) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/sessions/manual-start')
        .set(auth(t))
        .send({ connectorId: orgA.connectorId })
        .expect(201);

      expect(res.body.command.accepted).toBe(false);
      expect(res.body.command.code).toBe('CHARGER_OFFLINE');
      // Mensagem para uma pessoa, sem termo OCPP.
      expect(res.body.command.message).toBe(
        'O carregador está desconectado. Não é possível iniciar a recarga agora.',
      );
      // A sessão precisa sair do estado ativo, senão a próxima tentativa falha.
      expect(res.body.session.isActive).toBe(false);
    }

    const ativas = await prisma.chargingSession.count({
      where: {
        connectorId: orgA.connectorId,
        status: {
          in: [
            'PAYMENT_APPROVED',
            'AWAITING_CHARGER',
            'COMMAND_SENT',
            'STARTING',
            'CHARGING',
            'FINISHING',
          ],
        },
      },
    });

    expect(ativas).toBe(0);
  });

  it('cancela sessão que ainda não começou', async () => {
    const sessao = await prisma.chargingSession.create({
      data: {
        organizationId: orgA.id,
        siteId: orgA.siteId,
        chargerId: orgA.chargerId,
        connectorId: orgA.connectorId,
        status: 'PAYMENT_APPROVED',
      },
    });

    const t = await token(usuarios.operadorA);

    const res = await request(app.getHttpServer())
      .post(`/api/v1/sessions/${sessao.id}/cancel`)
      .set(auth(t))
      .send({ reason: 'motorista desistiu' })
      .expect(201);

    expect(res.body.statusLabel).toBe('Cancelada');
    expect(res.body.failureReason).toContain('motorista desistiu');
  });

  it('recusa cancelar recarga já iniciada, orientando a parar', async () => {
    const sessao = await prisma.chargingSession.create({
      data: {
        organizationId: orgA.id,
        siteId: orgA.siteId,
        chargerId: orgA.chargerId,
        connectorId: orgA.connectorId,
        status: 'CHARGING',
        ocppTransactionId: 555_555,
      },
    });

    const t = await token(usuarios.operadorA);

    const res = await request(app.getHttpServer())
      .post(`/api/v1/sessions/${sessao.id}/cancel`)
      .set(auth(t))
      .expect(409);

    expect(res.body.code).toBe('SESSION_ALREADY_STARTED');
    expect(res.body.message).toContain('Parar recarga');
  });
});

describe('Auditoria (briefing seção 12)', () => {
  it('registra quem iniciou a recarga manualmente', async () => {
    const t = await token(usuarios.operadorA);

    await request(app.getHttpServer())
      .post('/api/v1/sessions/manual-start')
      .set(auth(t))
      .send({ connectorId: orgA.connectorId })
      .expect(201);

    const registro = await prisma.auditLog.findFirst({
      where: { action: 'session.manual_start', user: { email: usuarios.operadorA } },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { email: true } } },
    });

    expect(registro).not.toBeNull();
    expect(registro!.user!.email).toBe(usuarios.operadorA);
    expect(registro!.organizationId).toBe(orgA.id);
    expect(registro!.entityType).toBe('ChargingSession');
  });

  it('registra bloqueio com o valor anterior e o novo', async () => {
    const t = await token(usuarios.operadorA);

    await request(app.getHttpServer())
      .patch(`/api/v1/chargers/${orgA.chargerId}/operational-status`)
      .set(auth(t))
      .send({ status: 'BLOCKED', reason: 'manutenção preventiva' })
      .expect(200);

    const registro = await prisma.auditLog.findFirst({
      where: { action: 'charger.block' },
      orderBy: { createdAt: 'desc' },
    });

    expect(registro).not.toBeNull();
    expect(registro!.previousValue).toEqual({ operationalStatus: 'AVAILABLE' });
    expect(registro!.newValue).toMatchObject({
      operationalStatus: 'BLOCKED',
      motivo: 'manutenção preventiva',
    });

    await prisma.charger.update({
      where: { id: orgA.chargerId },
      data: { operationalStatus: 'AVAILABLE' },
    });
  });

  it('a credencial nunca vai para o log de auditoria', async () => {
    const t = await token(usuarios.adminA);

    const res = await request(app.getHttpServer())
      .post(`/api/v1/chargers/${orgA.chargerId}/credential`)
      .set(auth(t))
      .expect(201);

    const registro = await prisma.auditLog.findFirst({
      where: { action: 'charger.rotate_credential' },
      orderBy: { createdAt: 'desc' },
    });

    expect(registro).not.toBeNull();
    expect(JSON.stringify(registro!.newValue)).not.toContain(res.body.credential);

    await prisma.charger.update({ where: { id: orgA.chargerId }, data: { credentialsHash: null } });
  });
});

describe('Rótulos em português (briefing seção 14)', () => {
  it('a listagem de carregadores traz rótulos, não só os enums', async () => {
    const t = await token(usuarios.adminA);

    const res = await request(app.getHttpServer()).get('/api/v1/chargers').set(auth(t)).expect(200);

    const charger = res.body.items.find(
      (c: { chargePointIdentity: string }) => c.chargePointIdentity === IDENTITY_A,
    );

    expect(charger.connectionStatusLabel).toMatch(/Online|Offline|Nunca conectou/);
    expect(charger.operationalStatusLabel).toMatch(/Liberado|Bloqueado|Em manutenção/);

    /**
     * O estado exato do conector depende de qual teste rodou antes, então
     * verificamos o que importa: que o rótulo é uma frase em português e não o
     * enum cru — nunca "SuspendedEVSE" na tela.
     */
    const rotulosValidos = [
      'Disponível',
      'Veículo conectado',
      'Carregando',
      'Pausado pelo veículo',
      'Pausado pelo carregador',
      'Finalizando',
      'Reservado',
      'Indisponível',
      'Em falha',
    ];

    expect(rotulosValidos).toContain(charger.connectors[0].statusLabel);
    expect(charger.connectors[0].statusLabel).not.toBe(charger.connectors[0].status);
  });

  it('a sessão traz o rótulo do estado e do motivo de encerramento', async () => {
    const sessao = await prisma.chargingSession.create({
      data: {
        organizationId: orgA.id,
        siteId: orgA.siteId,
        chargerId: orgA.chargerId,
        connectorId: orgA.connectorId,
        status: 'COMPLETED',
        stopReason: 'EV_DISCONNECTED',
        energyWh: 28_350,
      },
    });

    const t = await token(usuarios.adminA);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/sessions/${sessao.id}`)
      .set(auth(t))
      .expect(200);

    expect(res.body.statusLabel).toBe('Concluída');
    expect(res.body.stopReasonLabel).toBe('Veículo desconectado');
  });
});
