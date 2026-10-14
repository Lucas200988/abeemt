import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { hash } from '@node-rs/argon2';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './setup-app';

const SENHA = 'senha-de-teste-123';
const ARGON2 = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

let app: INestApplication;
let prisma: PrismaService;
let organizationId: string;

const usuarios = {
  admin: 'e2e-admin@sonare.com.br',
  gestor: 'e2e-gestor@sonare.com.br',
  operador: 'e2e-operador@sonare.com.br',
  visualizador: 'e2e-visualizador@sonare.com.br',
  inativo: 'e2e-inativo@sonare.com.br',
};

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);

  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany({ where: { email: { in: Object.values(usuarios) } } });

  const org = await prisma.organization.upsert({
    where: { slug: 'e2e-org' },
    update: {},
    create: { name: 'Organização E2E', slug: 'e2e-org' },
  });
  organizationId = org.id;

  const passwordHash = await hash(SENHA, ARGON2);

  await prisma.user.createMany({
    data: [
      { email: usuarios.admin, name: 'Admin E2E', passwordHash, role: 'SUPER_ADMIN' },
      {
        email: usuarios.gestor,
        name: 'Gestor E2E',
        passwordHash,
        role: 'ORG_ADMIN',
        organizationId,
      },
      {
        email: usuarios.operador,
        name: 'Operador E2E',
        passwordHash,
        role: 'OPERATOR',
        organizationId,
      },
      {
        email: usuarios.visualizador,
        name: 'Visualizador E2E',
        passwordHash,
        role: 'VIEWER',
        organizationId,
      },
      {
        email: usuarios.inativo,
        name: 'Inativo E2E',
        passwordHash,
        role: 'OPERATOR',
        organizationId,
        status: 'INACTIVE',
      },
    ],
  });
});

afterAll(async () => {
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany({ where: { email: { in: Object.values(usuarios) } } });
  await prisma.organization.deleteMany({ where: { slug: 'e2e-org' } });
  await app.close();
});

function login(email: string, password = SENHA) {
  return request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password });
}

describe('Health checks (briefing seção 13)', () => {
  it('GET /api/health responde sem exigir autenticação', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);

    expect(res.body.status).toBe('ok');
    expect(res.body).toHaveProperty('uptimeSeconds');
  });

  it('GET /api/ready verifica o banco de verdade', async () => {
    const res = await request(app.getHttpServer()).get('/api/ready').expect(200);

    expect(res.body.status).toBe('ok');
    expect(res.body.info.database.status).toBe('up');
    expect(res.body.info.database).toHaveProperty('responseTimeMs');
  });

  it('health e ready não são versionados', async () => {
    // Orquestradores esperam caminho estável; /api/v1/health não deve existir.
    await request(app.getHttpServer()).get('/api/v1/health').expect(404);
  });
});

describe('POST /auth/login', () => {
  it('autentica e devolve tokens e dados do usuário', async () => {
    const res = await login(usuarios.admin).expect(200);

    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
    expect(res.body.expiresIn).toBe(900);
    expect(res.body.user).toMatchObject({
      email: usuarios.admin,
      role: 'SUPER_ADMIN',
      roleLabel: 'Administrador global',
    });
  });

  it('nunca devolve o hash da senha', async () => {
    const res = await login(usuarios.admin).expect(200);

    expect(JSON.stringify(res.body)).not.toContain('argon2');
    expect(res.body.user).not.toHaveProperty('passwordHash');
  });

  it('registra lastLoginAt', async () => {
    await login(usuarios.operador).expect(200);

    const user = await prisma.user.findUnique({ where: { email: usuarios.operador } });
    expect(user?.lastLoginAt).toBeInstanceOf(Date);
  });

  /**
   * Não pode ser possível descobrir quais e-mails existem na plataforma
   * comparando as respostas. A mensagem e o código precisam ser idênticos.
   */
  it('devolve a mesma resposta para senha errada e usuário inexistente', async () => {
    const senhaErrada = await login(usuarios.admin, 'senha-errada-mas-longa').expect(401);
    const inexistente = await login('nao-existe@sonare.com.br').expect(401);

    expect(senhaErrada.body.code).toBe('INVALID_CREDENTIALS');
    expect(inexistente.body.code).toBe('INVALID_CREDENTIALS');
    expect(senhaErrada.body.message).toBe(inexistente.body.message);
  });

  it('recusa usuário inativo com código próprio', async () => {
    const res = await login(usuarios.inativo).expect(401);
    expect(res.body.code).toBe('USER_INACTIVE');
  });

  it('valida o formato do e-mail', async () => {
    const res = await login('nao-eh-email').expect(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('recusa senha curta demais', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: usuarios.admin, password: '123' })
      .expect(400);

    expect(res.body.details).toBeDefined();
  });

  it('rejeita campos não declarados no DTO', async () => {
    // whitelist + forbidNonWhitelisted: um payload com "role" não pode passar.
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: usuarios.admin, password: SENHA, role: 'SUPER_ADMIN' })
      .expect(400);
  });

  it('mensagens de erro estão em português', async () => {
    const res = await login(usuarios.admin, 'senha-errada-mas-longa').expect(401);
    expect(res.body.message).toBe('E-mail ou senha incorretos.');
  });
});

describe('GET /auth/me', () => {
  it('devolve o usuário autenticado', async () => {
    const { body } = await login(usuarios.gestor).expect(200);

    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .expect(200);

    expect(res.body).toMatchObject({
      email: usuarios.gestor,
      role: 'ORG_ADMIN',
      roleLabel: 'Administrador do estabelecimento',
      organizationId,
    });
  });

  it('recusa requisição sem token, em português', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);

    expect(res.body.code).toBe('UNAUTHENTICATED');
    expect(res.body.message).toMatch(/autenticado/);
  });

  it('recusa token malformado', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer nao.eh.um.token')
      .expect(401);
  });

  /**
   * A estratégia JWT revalida o usuário no banco a cada requisição. Sem isso,
   * desativar alguém só teria efeito quando o token expirasse.
   */
  it('recusa token de usuário desativado depois da emissão', async () => {
    const { body } = await login(usuarios.visualizador).expect(200);

    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .expect(200);

    await prisma.user.update({
      where: { email: usuarios.visualizador },
      data: { status: 'INACTIVE' },
    });

    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .expect(401);

    expect(res.body.code).toBe('USER_INACTIVE');

    await prisma.user.update({
      where: { email: usuarios.visualizador },
      data: { status: 'ACTIVE' },
    });
  });
});

describe('POST /auth/refresh — rotação e detecção de reuso', () => {
  it('emite um par novo e revoga o token usado', async () => {
    const { body: inicial } = await login(usuarios.operador).expect(200);

    const { body: renovado } = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: inicial.refreshToken })
      .expect(200);

    expect(renovado.refreshToken).not.toBe(inicial.refreshToken);
    expect(renovado.accessToken).toBeDefined();
  });

  /**
   * Reuso de refresh token é o sinal clássico de token roubado: o legítimo e o
   * atacante usam o mesmo token. Como não dá para saber qual é qual, a resposta
   * segura é derrubar toda a família de sessões.
   */
  it('ao detectar reuso, revoga todas as sessões do usuário', async () => {
    const { body: inicial } = await login(usuarios.operador).expect(200);

    const { body: renovado } = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: inicial.refreshToken })
      .expect(200);

    // Reuso do antigo: precisa falhar.
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: inicial.refreshToken })
      .expect(401);

    // E o token válido também deve ter sido derrubado.
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: renovado.refreshToken })
      .expect(401);
  });

  it('recusa refresh token inventado', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'nao.eh.valido' })
      .expect(401);
  });

  /**
   * O access token não pode ser aceito como refresh. Se os dois usassem a mesma
   * chave, esta troca funcionaria — e um access token vazado viraria sessão
   * permanente.
   */
  it('não aceita um access token no lugar do refresh', async () => {
    const { body } = await login(usuarios.admin).expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: body.accessToken })
      .expect(401);
  });
});

describe('POST /auth/logout', () => {
  it('revoga o refresh token', async () => {
    const { body } = await login(usuarios.gestor).expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .send({ refreshToken: body.refreshToken })
      .expect(204);

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: body.refreshToken })
      .expect(401);
  });

  it('é idempotente — repetir não gera erro', async () => {
    const { body } = await login(usuarios.gestor).expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .send({ refreshToken: body.refreshToken })
      .expect(204);

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .send({ refreshToken: body.refreshToken })
      .expect(204);
  });
});

describe('Armazenamento de refresh token', () => {
  it('guarda apenas o hash, nunca o token em claro', async () => {
    const { body } = await login(usuarios.admin).expect(200);

    const armazenado = await prisma.refreshToken.findFirst({
      where: { user: { email: usuarios.admin } },
      orderBy: { createdAt: 'desc' },
    });

    expect(armazenado).not.toBeNull();
    // Um vazamento do banco não pode entregar tokens utilizáveis.
    expect(armazenado!.tokenHash).not.toBe(body.refreshToken);
    expect(armazenado!.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('Formato de erro', () => {
  it('inclui requestId para rastreio', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);

    expect(res.body).toHaveProperty('requestId');
    expect(res.body).toHaveProperty('code');
    expect(res.body).toHaveProperty('timestamp');
    expect(res.body).toHaveProperty('path');
  });

  it('não vaza stack trace nem detalhe interno', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/rota-inexistente').expect(404);

    expect(JSON.stringify(res.body)).not.toContain('at ');
    expect(res.body).not.toHaveProperty('stack');
  });
});
