import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { hash } from '@node-rs/argon2';
import { OcppSimulator } from '@bora/ocpp-simulator';
import { PrismaService } from '../src/prisma/prisma.service';
import { OcppGateway } from '../src/modules/ocpp/ocpp.gateway';
import { OcppCommands } from '../src/modules/ocpp/ocpp-commands.service';
import { ConnectionRegistry } from '../src/modules/ocpp/connection-registry';
import { CallDispatcher } from '../src/modules/ocpp/call-dispatcher';
import { createTestApp } from './setup-app';

/**
 * Testes do núcleo OCPP contra o simulador.
 *
 * Sobe a aplicação de verdade, com WebSocket real, banco real e o simulador
 * conectando pela rede. Nada de mock do protocolo: o objetivo desta fase é
 * justamente provar que o diálogo OCPP funciona antes de encostar no WEMOB
 * (regra 18.2 e 18.19 do briefing).
 */

const IDENTITY = 'TEST-OCPP-001';
const IDENTITY_COM_SENHA = 'TEST-OCPP-AUTH';
const SENHA_CARREGADOR = 'credencial-de-teste-123';

let app: INestApplication;
let prisma: PrismaService;
let commands: OcppCommands;
let registry: ConnectionRegistry;
let dispatcher: CallDispatcher;
let baseUrl: string;

let organizationId: string;
let siteId: string;
let chargerId: string;
let connectorIds: string[] = [];

const simuladores: OcppSimulator[] = [];

/** Cria um simulador já registrado para limpeza automática ao fim do teste. */
function novoSimulador(
  options: Partial<Parameters<typeof OcppSimulator.prototype.constructor>[0]> = {},
) {
  const sim = new OcppSimulator({
    url: baseUrl,
    chargePointIdentity: IDENTITY,
    meterIntervalMs: 200,
    heartbeatIntervalMs: 500,
    autoReconnect: false,
    ...options,
  } as never);

  simuladores.push(sim);
  return sim;
}

/** Espera até a condição virar verdadeira, para não depender de sleep fixo. */
async function aguardar(
  condicao: () => Promise<boolean> | boolean,
  { timeoutMs = 8000, intervaloMs = 25, descricao = 'condição' } = {},
): Promise<void> {
  const limite = Date.now() + timeoutMs;

  while (Date.now() < limite) {
    if (await condicao()) return;
    await new Promise((r) => setTimeout(r, intervaloMs));
  }

  throw new Error(`tempo esgotado aguardando: ${descricao}`);
}

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  commands = app.get(OcppCommands);
  registry = app.get(ConnectionRegistry);
  dispatcher = app.get(CallDispatcher);

  // Porta 0: o sistema escolhe uma livre, evitando conflito com a API rodando.
  await app.listen(0);
  app.get(OcppGateway).attach(app.getHttpServer() as Server);

  const endereco = (app.getHttpServer() as Server).address();
  const porta = typeof endereco === 'object' && endereco ? endereco.port : 0;
  baseUrl = `ws://127.0.0.1:${porta}/ocpp`;

  const org = await prisma.organization.upsert({
    where: { slug: 'ocpp-e2e' },
    update: {},
    create: { name: 'Org OCPP E2E', slug: 'ocpp-e2e' },
  });
  organizationId = org.id;

  const site = await prisma.site.upsert({
    where: { organizationId_name: { organizationId, name: 'Site OCPP E2E' } },
    update: {},
    create: { organizationId, name: 'Site OCPP E2E' },
  });
  siteId = site.id;
});

beforeEach(async () => {
  // Estado limpo por teste: sessões de um teste não podem ocupar o conector do
  // seguinte (regra 11.1).
  await prisma.meterValue.deleteMany({ where: { charger: { site: { organizationId } } } });
  await prisma.chargingSession.deleteMany({ where: { organizationId } });
  await prisma.ocppMessage.deleteMany({ where: { charger: { site: { organizationId } } } });
  await prisma.connector.deleteMany({ where: { charger: { site: { organizationId } } } });
  await prisma.charger.deleteMany({ where: { siteId } });

  const charger = await prisma.charger.create({
    data: {
      siteId,
      chargePointIdentity: IDENTITY,
      name: 'Carregador de teste',
    },
  });
  chargerId = charger.id;

  connectorIds = [];
  for (const numero of [1, 2]) {
    const c = await prisma.connector.create({
      data: { chargerId, connectorNumber: numero, connectorType: 'CCS2', ratedPowerKw: 30 },
    });
    connectorIds.push(c.id);
  }
});

afterEach(async () => {
  await Promise.all(simuladores.splice(0).map((s) => s.disconnect().catch(() => undefined)));
});

afterAll(async () => {
  await prisma.meterValue.deleteMany({ where: { charger: { site: { organizationId } } } });
  await prisma.chargingSession.deleteMany({ where: { organizationId } });
  await prisma.ocppMessage.deleteMany({ where: { charger: { site: { organizationId } } } });
  await prisma.connector.deleteMany({ where: { charger: { site: { organizationId } } } });
  await prisma.charger.deleteMany({ where: { site: { organizationId } } });
  await prisma.site.deleteMany({ where: { organizationId } });
  await prisma.organization.delete({ where: { id: organizationId } });
  await app.close();
});

/** Cria uma sessão já com pagamento aprovado, como a FASE 5 fará. */
async function criarSessaoPaga(connectorIndex = 0) {
  return prisma.chargingSession.create({
    data: {
      organizationId,
      siteId,
      chargerId,
      connectorId: connectorIds[connectorIndex],
      status: 'PAYMENT_APPROVED',
      // Teto padrão do ADR-0008 §9.
      ceilingAmountCents: 20000,
    },
  });
}

// ===========================================================================

describe('Conexão e handshake', () => {
  it('aceita conexão com identity cadastrada e subprotocolo ocpp1.6', async () => {
    const sim = novoSimulador();
    await sim.connect();

    expect(sim.connected).toBe(true);
    await aguardar(() => registry.isOnline(IDENTITY), { descricao: 'registro da conexão' });
  });

  it('recusa identity não cadastrada', async () => {
    const sim = novoSimulador({ chargePointIdentity: 'NAO-EXISTE-999' });

    await expect(sim.connect()).rejects.toThrow(/404|recusou/);
  });

  it('marca o carregador como ONLINE no banco, não só em memória', async () => {
    const sim = novoSimulador();
    await sim.connect();

    // O painel consulta o banco; depender da memória de um processo quebraria
    // com mais de uma instância (ADR-0006).
    await aguardar(
      async () => {
        const c = await prisma.charger.findUnique({ where: { id: chargerId } });
        return c?.connectionStatus === 'ONLINE';
      },
      { descricao: 'connectionStatus ONLINE no banco' },
    );
  });

  it('marca OFFLINE ao desconectar', async () => {
    const sim = novoSimulador();
    await sim.connect();
    await aguardar(() => registry.isOnline(IDENTITY));

    await sim.disconnect();

    await aguardar(
      async () => {
        const c = await prisma.charger.findUnique({ where: { id: chargerId } });
        return c?.connectionStatus === 'OFFLINE';
      },
      { descricao: 'connectionStatus OFFLINE' },
    );
  });

  describe('autenticação por credencial individual', () => {
    beforeEach(async () => {
      await prisma.charger.create({
        data: {
          siteId,
          chargePointIdentity: IDENTITY_COM_SENHA,
          name: 'Carregador com credencial',
          credentialsHash: await hash(SENHA_CARREGADOR, {
            memoryCost: 19456,
            timeCost: 2,
            parallelism: 1,
          }),
        },
      });
    });

    it('aceita a credencial correta', async () => {
      const sim = novoSimulador({
        chargePointIdentity: IDENTITY_COM_SENHA,
        password: SENHA_CARREGADOR,
      });

      await sim.connect();
      expect(sim.connected).toBe(true);
    });

    it('recusa credencial errada', async () => {
      const sim = novoSimulador({
        chargePointIdentity: IDENTITY_COM_SENHA,
        password: 'senha-errada',
      });

      await expect(sim.connect()).rejects.toThrow(/401|recusou/);
    });

    it('recusa conexão sem credencial quando o carregador exige uma', async () => {
      const sim = novoSimulador({ chargePointIdentity: IDENTITY_COM_SENHA });

      await expect(sim.connect()).rejects.toThrow(/401|recusou/);
    });
  });
});

describe('BootNotification', () => {
  it('é aceito e grava os dados do equipamento', async () => {
    const sim = novoSimulador({
      vendor: 'WEG',
      model: 'WEMOB Station',
      firmwareVersion: '2.4.1',
      serialNumber: 'SN-12345',
    });

    await sim.connect();
    const resposta = await sim.bootNotification();

    expect(resposta.status).toBe('Accepted');
    expect(resposta.currentTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(resposta.interval).toBeGreaterThan(0);

    const charger = await prisma.charger.findUnique({ where: { id: chargerId } });
    expect(charger?.manufacturer).toBe('WEG');
    expect(charger?.model).toBe('WEMOB Station');
    expect(charger?.firmwareVersion).toBe('2.4.1');
    expect(charger?.serialNumber).toBe('SN-12345');
    expect(charger?.lastBootAt).toBeInstanceOf(Date);
  });

  /**
   * Carregador bloqueado pelo operador recebe "Pending", não "Rejected":
   * Rejected faria o equipamento parar de tentar, dificultando o desbloqueio.
   */
  it('responde Pending para carregador bloqueado', async () => {
    await prisma.charger.update({
      where: { id: chargerId },
      data: { operationalStatus: 'BLOCKED' },
    });

    const sim = novoSimulador();
    await sim.connect();

    expect((await sim.bootNotification()).status).toBe('Pending');
  });

  it('recusa payload sem campo obrigatório', async () => {
    const sim = novoSimulador();
    await sim.connect();

    // BootNotification sem chargePointModel.
    await expect(sim.sendInvalidPayload()).rejects.toThrow(/TypeConstraintViolation/);
  });
});

describe('Heartbeat', () => {
  it('responde com a hora do servidor e atualiza lastHeartbeatAt', async () => {
    const sim = novoSimulador();
    await sim.connect();
    await sim.bootNotification();

    const resposta = await sim.heartbeat();
    expect(resposta.currentTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const charger = await prisma.charger.findUnique({ where: { id: chargerId } });
    expect(charger?.lastHeartbeatAt).toBeInstanceOf(Date);
  });
});

describe('StatusNotification', () => {
  it('atualiza o estado do conector', async () => {
    const sim = novoSimulador();
    await sim.connect();
    await sim.bootNotification();

    await sim.statusNotification(1, 'Available');
    await aguardar(async () => {
      const c = await prisma.connector.findUnique({ where: { id: connectorIds[0] } });
      return c?.status === 'AVAILABLE';
    });

    await sim.statusNotification(1, 'Preparing');
    await aguardar(async () => {
      const c = await prisma.connector.findUnique({ where: { id: connectorIds[0] } });
      return c?.status === 'PREPARING';
    });
  });

  it('registra o código de erro quando o carregador reporta falha', async () => {
    const sim = novoSimulador();
    await sim.connect();
    await sim.bootNotification();

    await sim.simulateFault(1, 'GroundFailure');

    await aguardar(async () => {
      const c = await prisma.connector.findUnique({ where: { id: connectorIds[0] } });
      return c?.status === 'FAULTED' && c?.errorCode === 'GroundFailure';
    });
  });

  it('limpa o código de erro quando volta a NoError', async () => {
    const sim = novoSimulador();
    await sim.connect();
    await sim.bootNotification();

    await sim.simulateFault(1, 'OverVoltage');
    await aguardar(async () => {
      const c = await prisma.connector.findUnique({ where: { id: connectorIds[0] } });
      return c?.errorCode === 'OverVoltage';
    });

    await sim.statusNotification(1, 'Available', 'NoError');
    await aguardar(async () => {
      const c = await prisma.connector.findUnique({ where: { id: connectorIds[0] } });
      return c?.errorCode === null;
    });
  });

  /** O conector 0 representa o carregador inteiro, não um ponto de recarga. */
  it('aceita o conector 0 sem criar registro de conector', async () => {
    const sim = novoSimulador();
    await sim.connect();
    await sim.bootNotification();

    await sim.statusNotification(0, 'Available');

    const total = await prisma.connector.count({ where: { chargerId } });
    expect(total).toBe(2);
  });
});

describe('Authorize', () => {
  it('aceita idTag de sessão paga aguardando início', async () => {
    const sessao = await criarSessaoPaga();
    await prisma.chargingSession.update({
      where: { id: sessao.id },
      data: { idTag: 'TAG-VALIDA' },
    });

    const sim = novoSimulador();
    await sim.connect();
    await sim.bootNotification();

    const resposta = (await sim.authorize('TAG-VALIDA')) as {
      idTagInfo: { status: string };
    };

    expect(resposta.idTagInfo.status).toBe('Accepted');
  });

  /**
   * Sem esta recusa, qualquer cartão RFID encostado no leitor iniciaria uma
   * recarga sem pagamento.
   */
  it('recusa idTag sem sessão paga correspondente', async () => {
    const sim = novoSimulador();
    await sim.connect();
    await sim.bootNotification();

    const resposta = (await sim.authorize('TAG-QUALQUER')) as {
      idTagInfo: { status: string };
    };

    expect(resposta.idTagInfo.status).toBe('Invalid');
  });
});

// ===========================================================================

describe('Fluxo completo — os 12 passos do critério de aceite da FASE 2', () => {
  it('vai do BootNotification à sessão concluída', async () => {
    // 1. Simulador conecta
    const sim = novoSimulador({ meterIntervalMs: 150 });
    await sim.connect();
    expect(sim.connected).toBe(true);

    // 2 e 3. BootNotification aceito
    expect((await sim.bootNotification()).status).toBe('Accepted');

    // 4. Heartbeat
    expect(await sim.heartbeat()).toHaveProperty('currentTime');

    // 5. Conector informa Available
    await sim.statusNotification(1, 'Available');
    await aguardar(async () => {
      const c = await prisma.connector.findUnique({ where: { id: connectorIds[0] } });
      return c?.status === 'AVAILABLE';
    });

    // Veículo é conectado, e o pagamento (simulado aqui) já foi aprovado.
    await sim.plugIn(1);
    const sessao = await criarSessaoPaga();

    // 6 e 7. Backend envia RemoteStartTransaction; simulador aceita
    const inicio = await commands.remoteStart({ sessionId: sessao.id });
    expect(inicio.accepted).toBe(true);
    expect(inicio.message).toBe('Comando aceito. Aguardando o veículo iniciar a recarga.');

    // 8. Simulador envia StartTransaction
    await aguardar(
      async () => {
        const s = await prisma.chargingSession.findUnique({ where: { id: sessao.id } });
        return s?.status === 'CHARGING' && s.ocppTransactionId !== null;
      },
      { descricao: 'sessão em CHARGING com transactionId' },
    );

    const emCarga = await prisma.chargingSession.findUnique({ where: { id: sessao.id } });
    expect(emCarga?.meterStartWh).toBe(1_000_000);
    expect(emCarga?.startedAt).toBeInstanceOf(Date);
    expect(emCarga?.idTag).toBeTruthy();

    // 9. Simulador envia MeterValues, e a energia acumula
    await aguardar(
      async () => {
        const s = await prisma.chargingSession.findUnique({ where: { id: sessao.id } });
        return (s?.energyWh ?? 0) > 0;
      },
      { descricao: 'energia acumulada a partir dos MeterValues' },
    );

    const leituras = await prisma.meterValue.count({ where: { sessionId: sessao.id } });
    expect(leituras).toBeGreaterThan(0);

    // 10 e 11. Backend envia RemoteStopTransaction; simulador envia StopTransaction
    const parada = await commands.remoteStop({ sessionId: sessao.id });
    expect(parada.accepted).toBe(true);

    // 12. Sessão concluída
    await aguardar(
      async () => {
        const s = await prisma.chargingSession.findUnique({ where: { id: sessao.id } });
        return s?.status === 'COMPLETED';
      },
      { descricao: 'sessão concluída' },
    );

    const concluida = await prisma.chargingSession.findUnique({ where: { id: sessao.id } });

    expect(concluida?.status).toBe('COMPLETED');
    expect(concluida?.meterStopWh).toBeGreaterThan(concluida!.meterStartWh!);
    expect(concluida?.energyWh).toBe(concluida!.meterStopWh! - concluida!.meterStartWh!);
    expect(concluida?.durationSeconds).toBeGreaterThanOrEqual(0);
    expect(concluida?.stopReason).toBe('REMOTE_STOP');
    expect(concluida?.failureReason).toBeNull();

    // Energia em Wh inteiro (ADR-0005).
    expect(Number.isInteger(concluida!.energyWh!)).toBe(true);
  });

  it('registra todas as mensagens trocadas', async () => {
    const sim = novoSimulador();
    await sim.connect();
    await sim.bootNotification();
    await sim.statusNotification(1, 'Available');
    await sim.plugIn(1);

    const sessao = await criarSessaoPaga();
    await commands.remoteStart({ sessionId: sessao.id });

    await aguardar(async () => {
      const s = await prisma.chargingSession.findUnique({ where: { id: sessao.id } });
      return s?.status === 'CHARGING';
    });

    const mensagens = await prisma.ocppMessage.findMany({ where: { chargerId } });
    const acoes = mensagens.map((m) => m.action);

    expect(acoes).toContain('BootNotification');
    expect(acoes).toContain('StatusNotification');
    expect(acoes).toContain('RemoteStartTransaction');
    expect(acoes).toContain('StartTransaction');

    const entrada = mensagens.filter((m) => m.direction === 'INBOUND');
    const saida = mensagens.filter((m) => m.direction === 'OUTBOUND');
    expect(entrada.length).toBeGreaterThan(0);
    expect(saida.length).toBeGreaterThan(0);

    // O comando enviado tem correlationId e tempo de resposta medido (seção 13).
    const comando = saida.find((m) => m.action === 'RemoteStartTransaction');
    expect(comando?.correlationId).toBeTruthy();
    expect(comando?.responsePayload).toEqual({ status: 'Accepted' });
    expect(comando?.processingDurationMs).toBeGreaterThanOrEqual(0);
  });
});

// ===========================================================================

describe('RemoteStartTransaction — casos de recusa', () => {
  it('recusa quando o carregador está offline', async () => {
    const sessao = await criarSessaoPaga();

    const resultado = await commands.remoteStart({ sessionId: sessao.id });

    expect(resultado.accepted).toBe(false);
    expect(resultado.code).toBe('CHARGER_OFFLINE');
    // Mensagem em português, sem termo OCPP (seção 14).
    expect(resultado.message).toBe(
      'O carregador está desconectado. Não é possível iniciar a recarga agora.',
    );
  });

  it('traduz a recusa do carregador para linguagem do operador', async () => {
    const sim = novoSimulador({ rejectRemoteStart: true });
    await sim.connect();
    await sim.bootNotification();
    await sim.statusNotification(1, 'Available');

    const sessao = await criarSessaoPaga();
    const resultado = await commands.remoteStart({ sessionId: sessao.id });

    expect(resultado.accepted).toBe(false);
    expect(resultado.code).toBe('REJECTED_BY_CHARGER');
    // Não "RemoteStartTransaction rejected".
    expect(resultado.message).toBe('O carregador recusou o comando de início da recarga.');

    const atualizada = await prisma.chargingSession.findUnique({ where: { id: sessao.id } });
    expect(atualizada?.status).toBe('DECLINED');
  });

  it('recusa quando o conector está indisponível', async () => {
    const sim = novoSimulador();
    await sim.connect();
    await sim.bootNotification();
    await sim.statusNotification(1, 'Faulted', 'OtherError');

    await aguardar(async () => {
      const c = await prisma.connector.findUnique({ where: { id: connectorIds[0] } });
      return c?.status === 'FAULTED';
    });

    const sessao = await criarSessaoPaga();
    const resultado = await commands.remoteStart({ sessionId: sessao.id });

    expect(resultado.accepted).toBe(false);
    expect(resultado.code).toBe('CONNECTOR_UNAVAILABLE');
  });

  /**
   * Regra 11.1 — um conector não pode ter duas recargas ao mesmo tempo.
   *
   * Verificado em 2026-07-29: a garantia é mais forte do que se supunha. O
   * índice parcial cobre TODOS os estados ativos, inclusive `PAYMENT_APPROVED`,
   * então o banco recusa a **criação** da segunda sessão ativa. Não existe
   * momento em que duas sessões concorrem pelo mesmo conector e a aplicação
   * precisa escolher.
   *
   * Por isso o `remoteStart` não tem verificação de "conector ocupado": seria
   * código inalcançável. O caminho real é a aprovação de pagamento (FASE 5)
   * receber P2002, que o filtro global traduz para linguagem de operador.
   */
  it('o banco impede criar uma segunda sessão ativa no mesmo conector', async () => {
    const sim = novoSimulador();
    await sim.connect();
    await sim.bootNotification();
    await sim.statusNotification(1, 'Available');
    await sim.plugIn(1);

    const primeira = await criarSessaoPaga();
    expect((await commands.remoteStart({ sessionId: primeira.id })).accepted).toBe(true);

    await aguardar(async () => {
      const s = await prisma.chargingSession.findUnique({ where: { id: primeira.id } });
      return s?.status === 'CHARGING';
    });

    // A tentativa de criar uma segunda sessão ATIVA no mesmo conector falha no
    // banco — não depende de nenhuma verificação em memória vencer a corrida.
    await expect(
      prisma.chargingSession.create({
        data: {
          organizationId,
          siteId,
          chargerId,
          connectorId: connectorIds[0],
          status: 'PAYMENT_APPROVED',
        },
      }),
    ).rejects.toThrow(/[Uu]nique constraint/);

    // Uma única sessão no conector, como manda a regra.
    const ativas = await prisma.chargingSession.count({
      where: {
        connectorId: connectorIds[0],
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
    expect(ativas).toBe(1);

    // O outro conector do mesmo carregador segue livre.
    await expect(
      prisma.chargingSession.create({
        data: {
          organizationId,
          siteId,
          chargerId,
          connectorId: connectorIds[1],
          status: 'PAYMENT_APPROVED',
        },
      }),
    ).resolves.toBeDefined();
  });

  it('recusa quando o carregador está bloqueado pelo operador', async () => {
    const sim = novoSimulador();
    await sim.connect();
    await sim.bootNotification();
    await sim.statusNotification(1, 'Available');

    await prisma.charger.update({
      where: { id: chargerId },
      data: { operationalStatus: 'BLOCKED' },
    });

    const sessao = await criarSessaoPaga();
    const resultado = await commands.remoteStart({ sessionId: sessao.id });

    expect(resultado.accepted).toBe(false);
    expect(resultado.code).toBe('CHARGER_BLOCKED');
    expect(resultado.message).toBe('Este carregador está bloqueado.');
  });

  it('recusa sessão em estado que não permite início', async () => {
    const sim = novoSimulador();
    await sim.connect();
    await sim.bootNotification();

    const sessao = await prisma.chargingSession.create({
      data: {
        organizationId,
        siteId,
        chargerId,
        connectorId: connectorIds[0],
        status: 'AWAITING_PAYMENT',
      },
    });

    const resultado = await commands.remoteStart({ sessionId: sessao.id });

    expect(resultado.accepted).toBe(false);
    expect(resultado.code).toBe('INVALID_SESSION_STATUS');
  });

  /** Regra 11.5: sem timeout, a sessão ficaria presa em "comando enviado". */
  it('expira quando o carregador não responde', async () => {
    const sim = novoSimulador({ goSilent: true });
    await sim.connect();
    await sim.bootNotification();
    await sim.statusNotification(1, 'Available');

    const sessao = await criarSessaoPaga();

    // Timeout curto para o teste não levar 120 segundos.
    const resultado = await dispatcher.call(
      IDENTITY,
      'RemoteStartTransaction',
      { idTag: 'TESTE', connectorId: 1 },
      { timeoutMs: 400 },
    );

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.reason).toBe('TIMEOUT');
      expect(resultado.message).toBe(
        'O carregador não respondeu ao comando dentro do tempo previsto.',
      );
    }

    expect(sessao.id).toBeTruthy();
  });

  it('trata CALLERROR do carregador como recusa', async () => {
    const sim = novoSimulador({ respondWithCallError: true });
    await sim.connect();
    await sim.bootNotification();

    const resultado = await dispatcher.call(
      IDENTITY,
      'RemoteStartTransaction',
      { idTag: 'TESTE', connectorId: 1 },
      { timeoutMs: 3000 },
    );

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.reason).toBe('CALLERROR');
      expect(resultado.message).toBe('O carregador recusou o comando.');
    }
  });

  it('cancela comandos pendentes quando o carregador desconecta', async () => {
    const sim = novoSimulador({ goSilent: true });
    await sim.connect();
    await sim.bootNotification();

    const promessa = dispatcher.call(
      IDENTITY,
      'RemoteStartTransaction',
      { idTag: 'TESTE', connectorId: 1 },
      { timeoutMs: 30_000 },
    );

    await aguardar(() => dispatcher.pendingCount() > 0, { descricao: 'comando pendente' });

    // Sem cancelar na desconexão, o comando só falharia após 30 segundos.
    sim.simulateConnectionLoss();

    const resultado = await promessa;
    expect(resultado.ok).toBe(false);
    expect(dispatcher.pendingCount()).toBe(0);
  });
});

describe('RemoteStopTransaction', () => {
  it('recusa parar sessão que ainda não começou', async () => {
    const sessao = await criarSessaoPaga();

    const resultado = await commands.remoteStop({ sessionId: sessao.id });

    expect(resultado.accepted).toBe(false);
    expect(resultado.code).toBe('NOT_STARTED');
  });

  it('é idempotente para sessão já concluída', async () => {
    const sessao = await prisma.chargingSession.create({
      data: {
        organizationId,
        siteId,
        chargerId,
        connectorId: connectorIds[0],
        status: 'COMPLETED',
        ocppTransactionId: 999_999,
      },
    });

    const resultado = await commands.remoteStop({ sessionId: sessao.id });

    // Parar algo já parado não é erro.
    expect(resultado.accepted).toBe(true);
    expect(resultado.code).toBe('ALREADY_COMPLETED');
  });

  it('trata recusa do carregador', async () => {
    const sim = novoSimulador({ rejectRemoteStop: true });
    await sim.connect();
    await sim.bootNotification();
    await sim.statusNotification(1, 'Available');
    await sim.plugIn(1);

    const sessao = await criarSessaoPaga();
    await commands.remoteStart({ sessionId: sessao.id });

    await aguardar(async () => {
      const s = await prisma.chargingSession.findUnique({ where: { id: sessao.id } });
      return s?.status === 'CHARGING';
    });

    const resultado = await commands.remoteStop({ sessionId: sessao.id });

    expect(resultado.accepted).toBe(false);
    expect(resultado.message).toBe('O carregador recusou o comando para encerrar a recarga.');
  });
});

describe('Encerramento pelo veículo (StopTransaction espontâneo)', () => {
  it('conclui a sessão quando o motorista desconecta o veículo', async () => {
    const sim = novoSimulador();
    await sim.connect();
    await sim.bootNotification();
    await sim.statusNotification(1, 'Available');
    await sim.plugIn(1);

    const sessao = await criarSessaoPaga();
    await commands.remoteStart({ sessionId: sessao.id });

    /**
     * A espera precisa cobrir os DOIS lados.
     *
     * O servidor grava `CHARGING` antes de responder o `StartTransaction`, então
     * existe um instante em que a sessão já está carregando e o simulador ainda
     * não recebeu o `transactionId`. Esperar só pelo banco fazia este teste
     * falhar de forma intermitente, com "não há transação em andamento para
     * encerrar" — só na suíte completa, onde a máquina está mais carregada.
     * Observado em 2026-07-30.
     */
    await aguardar(
      async () => {
        const s = await prisma.chargingSession.findUnique({ where: { id: sessao.id } });
        return s?.status === 'CHARGING' && sim.transactionId !== null;
      },
      { descricao: 'recarga em curso no servidor e no carregador' },
    );

    sim.advanceMeter(5_000);
    await sim.stopTransaction('EVDisconnected');

    await aguardar(async () => {
      const s = await prisma.chargingSession.findUnique({ where: { id: sessao.id } });
      return s?.status === 'COMPLETED';
    });

    const concluida = await prisma.chargingSession.findUnique({ where: { id: sessao.id } });
    // O motivo precisa distinguir "motorista tirou o cabo" de falha (seção 11.8).
    expect(concluida?.stopReason).toBe('EV_DISCONNECTED');
    expect(concluida?.energyWh).toBeGreaterThan(0);
  });
});

describe('Reconexão', () => {
  it('aceita o carregador de volta e volta a aceitar comandos', async () => {
    const sim = novoSimulador();
    await sim.connect();
    await sim.bootNotification();
    await aguardar(() => registry.isOnline(IDENTITY));

    sim.simulateConnectionLoss();
    await aguardar(() => !registry.isOnline(IDENTITY), { descricao: 'saída do registro' });

    // Reconecta, como um carregador real faz após queda de sinal.
    const reconectado = novoSimulador();
    await reconectado.connect();
    await reconectado.bootNotification();
    await reconectado.statusNotification(1, 'Available');
    await reconectado.plugIn(1);

    await aguardar(() => registry.isOnline(IDENTITY));

    const sessao = await criarSessaoPaga();
    expect((await commands.remoteStart({ sessionId: sessao.id })).accepted).toBe(true);
  });

  /**
   * Queda de 4G costuma deixar o socket antigo "vivo" por minutos. Se a conexão
   * nova não substituísse a antiga, comandos iriam para um socket morto.
   */
  it('substitui a conexão anterior quando a mesma identity reconecta', async () => {
    const primeiro = novoSimulador();
    await primeiro.connect();
    await primeiro.bootNotification();

    const segundo = novoSimulador();
    await segundo.connect();
    await segundo.bootNotification();

    await aguardar(() => registry.isOnline(IDENTITY));
    // Uma conexão por identity, sempre.
    expect(registry.count()).toBe(1);

    await aguardar(() => !primeiro.connected, { descricao: 'fechamento da conexão antiga' });

    await segundo.statusNotification(1, 'Available');
    await segundo.plugIn(1);

    const sessao = await criarSessaoPaga();
    expect((await commands.remoteStart({ sessionId: sessao.id })).accepted).toBe(true);
  });
});

describe('Mensagens inválidas', () => {
  it('responde NotImplemented para ação não suportada, sem cair', async () => {
    const sim = novoSimulador();
    await sim.connect();
    await sim.bootNotification();

    await expect(sim.sendUnsupportedAction()).rejects.toThrow(/NotImplemented/);

    // A conexão continua utilizável.
    expect(await sim.heartbeat()).toHaveProperty('currentTime');
  });

  it('sobrevive a JSON inválido e registra a mensagem', async () => {
    const sim = novoSimulador();
    await sim.connect();
    await sim.bootNotification();

    sim.sendMalformedJson();

    await aguardar(
      async () => {
        const total = await prisma.ocppMessage.count({
          where: { chargerId, errorCode: 'FormationViolation' },
        });
        return total > 0;
      },
      { descricao: 'registro da mensagem malformada' },
    );

    expect(await sim.heartbeat()).toHaveProperty('currentTime');
  });

  it('sobrevive a estrutura OCPP inválida', async () => {
    const sim = novoSimulador();
    await sim.connect();
    await sim.bootNotification();

    sim.sendInvalidStructure();
    await new Promise((r) => setTimeout(r, 150));

    expect(await sim.heartbeat()).toHaveProperty('currentTime');
  });
});

describe('Idempotência — regra 11.3 e risco R-08', () => {
  /**
   * O critério de aceite da fase exige que chamadas duplicadas não criem
   * sessões duplicadas. Um carregador que não recebe a resposta retransmite a
   * mesma mensagem, com o mesmo messageId.
   */
  it('StartTransaction retransmitido devolve o mesmo transactionId', async () => {
    const sim = novoSimulador();
    await sim.connect();
    await sim.bootNotification();
    await sim.statusNotification(1, 'Available');
    await sim.plugIn(1);

    const sessao = await criarSessaoPaga();
    await prisma.chargingSession.update({
      where: { id: sessao.id },
      data: { status: 'AWAITING_CHARGER', idTag: 'TAG-DUP' },
    });

    const messageId = 'retransmitido-1';
    const payload = {
      connectorId: 1,
      idTag: 'TAG-DUP',
      meterStart: 1_000_000,
      timestamp: new Date().toISOString(),
    };

    // Primeira vez.
    sim.sendRawCall(messageId, 'StartTransaction', payload);
    await aguardar(async () => {
      const s = await prisma.chargingSession.findUnique({ where: { id: sessao.id } });
      return s?.ocppTransactionId !== null;
    });

    const depoisDaPrimeira = await prisma.chargingSession.findUnique({
      where: { id: sessao.id },
    });
    const transactionId = depoisDaPrimeira!.ocppTransactionId;

    // Mesma mensagem, mesmo messageId.
    sim.sendRawCall(messageId, 'StartTransaction', payload);
    await new Promise((r) => setTimeout(r, 400));

    const sessoes = await prisma.chargingSession.findMany({ where: { organizationId } });

    // Uma sessão, um transactionId.
    expect(sessoes).toHaveLength(1);
    expect(sessoes[0].ocppTransactionId).toBe(transactionId);
  });

  it('mensagem retransmitida não é processada duas vezes', async () => {
    const sim = novoSimulador();
    await sim.connect();
    await sim.bootNotification();

    const messageId = 'heartbeat-dup';
    sim.sendRawCall(messageId, 'Heartbeat', {});
    await new Promise((r) => setTimeout(r, 200));
    sim.sendRawCall(messageId, 'Heartbeat', {});
    await new Promise((r) => setTimeout(r, 200));

    // O índice único parcial impede o segundo registro.
    const registros = await prisma.ocppMessage.count({
      where: { chargerId, messageId, direction: 'INBOUND' },
    });
    expect(registros).toBe(1);
  });
});

describe('MeterValues', () => {
  it('normaliza leituras em kWh para Wh — divergência de firmware (risco R-11)', async () => {
    const sim = novoSimulador({ energyUnit: 'kWh', meterIntervalMs: 150 });
    await sim.connect();
    await sim.bootNotification();
    await sim.statusNotification(1, 'Available');
    await sim.plugIn(1);

    const sessao = await criarSessaoPaga();
    await commands.remoteStart({ sessionId: sessao.id });

    await aguardar(async () => {
      const s = await prisma.chargingSession.findUnique({ where: { id: sessao.id } });
      return (s?.energyWh ?? 0) > 0;
    });

    const s = await prisma.chargingSession.findUnique({ where: { id: sessao.id } });

    // Energia em Wh inteiro, apesar de o carregador mandar kWh fracionário.
    expect(Number.isInteger(s!.energyWh!)).toBe(true);
    expect(s!.energyWh!).toBeGreaterThan(0);
    // Um carregador de 30 kW não entrega megawatts-hora em segundos.
    expect(s!.energyWh!).toBeLessThan(1_000_000);
  });

  /**
   * Exigência da seção 16. Se a leitura atrasada fosse aceita, a energia da
   * sessão — e o valor a cobrar — diminuiria.
   */
  it('não reduz a energia acumulada com leitura fora de ordem', async () => {
    const sim = novoSimulador({ sendOutOfOrderMeterValues: true, meterIntervalMs: 150 });
    await sim.connect();
    await sim.bootNotification();
    await sim.statusNotification(1, 'Available');
    await sim.plugIn(1);

    const sessao = await criarSessaoPaga();
    await commands.remoteStart({ sessionId: sessao.id });

    await aguardar(async () => {
      const s = await prisma.chargingSession.findUnique({ where: { id: sessao.id } });
      return (s?.energyWh ?? 0) > 0;
    });

    const leituras: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const s = await prisma.chargingSession.findUnique({ where: { id: sessao.id } });
      leituras.push(s!.energyWh!);
      await new Promise((r) => setTimeout(r, 180));
    }

    // Monotônico: nunca diminui.
    for (let i = 1; i < leituras.length; i += 1) {
      expect(leituras[i]).toBeGreaterThanOrEqual(leituras[i - 1]);
    }
  });

  it('guarda todas as amostras cruas para diagnóstico', async () => {
    const sim = novoSimulador({ meterIntervalMs: 150 });
    await sim.connect();
    await sim.bootNotification();
    await sim.statusNotification(1, 'Available');
    await sim.plugIn(1);

    const sessao = await criarSessaoPaga();
    await commands.remoteStart({ sessionId: sessao.id });

    await aguardar(async () => {
      const total = await prisma.meterValue.count({ where: { sessionId: sessao.id } });
      return total >= 2;
    });

    const amostras = await prisma.meterValue.findMany({ where: { sessionId: sessao.id } });
    const medidas = new Set(amostras.map((a) => a.measurand));

    expect(medidas).toContain('Energy.Active.Import.Register');
    // O simulador manda potência também; guardar tudo ajuda no diagnóstico.
    expect(medidas).toContain('Power.Active.Import');
    expect(amostras[0].rawPayload).toBeTruthy();
  });
});

describe('Medição inconsistente', () => {
  /**
   * Leitura final menor que a inicial acontece de verdade: medidor reiniciado,
   * troca de firmware, leitura corrompida. Não pode virar energia negativa nem
   * valor negativo a cobrar.
   */
  it('marca a sessão para revisão em vez de gerar energia negativa', async () => {
    const sim = novoSimulador();
    await sim.connect();
    await sim.bootNotification();
    await sim.statusNotification(1, 'Available');
    await sim.plugIn(1);

    const sessao = await criarSessaoPaga();
    await commands.remoteStart({ sessionId: sessao.id });

    await aguardar(async () => {
      const s = await prisma.chargingSession.findUnique({ where: { id: sessao.id } });
      return s?.status === 'CHARGING' && s.ocppTransactionId !== null;
    });

    const emCarga = await prisma.chargingSession.findUnique({ where: { id: sessao.id } });

    // Simula medidor reiniciado: leitura final abaixo da inicial.
    sim.sendRawCall('stop-inconsistente', 'StopTransaction', {
      transactionId: emCarga!.ocppTransactionId,
      meterStop: 500,
      timestamp: new Date().toISOString(),
      reason: 'Local',
    });

    await aguardar(async () => {
      const s = await prisma.chargingSession.findUnique({ where: { id: sessao.id } });
      return s?.status === 'COMPLETED';
    });

    const concluida = await prisma.chargingSession.findUnique({ where: { id: sessao.id } });

    expect(concluida?.energyWh).toBe(0);
    expect(concluida!.energyWh!).toBeGreaterThanOrEqual(0);
    expect(concluida?.failureReason).toMatch(/menor que a inicial/);
  });
});

describe('Recarga sem pagamento', () => {
  /**
   * Alguém usou o cartão RFID do próprio carregador. Precisamos registrar para
   * conciliação, não ignorar — o briefing (seção 16) pede distinguir esse caso.
   */
  it('registra sessão sem pagamento quando o StartTransaction não tem sessão correspondente', async () => {
    const sim = novoSimulador();
    await sim.connect();
    await sim.bootNotification();
    await sim.statusNotification(1, 'Available');

    await sim.startTransaction(1, 'RFID-DESCONHECIDO');

    await aguardar(
      async () => {
        const total = await prisma.chargingSession.count({
          where: { organizationId, paymentId: null, idTag: 'RFID-DESCONHECIDO' },
        });
        return total === 1;
      },
      { descricao: 'sessão sem pagamento registrada' },
    );

    const orfa = await prisma.chargingSession.findFirst({
      where: { idTag: 'RFID-DESCONHECIDO' },
    });

    expect(orfa?.status).toBe('CHARGING');
    expect(orfa?.paymentId).toBeNull();
    expect(orfa?.failureReason).toMatch(/sem pagamento/);
  });
});

describe('Estado do servidor OCPP (observabilidade — seção 13)', () => {
  it('expõe carregadores online e comandos pendentes', async () => {
    const sim = novoSimulador();
    await sim.connect();
    await sim.bootNotification();
    await aguardar(() => registry.isOnline(IDENTITY));

    const status = commands.status();

    expect(status.onlineChargers).toBe(1);
    expect(status.identities).toContain(IDENTITY);
    expect(status.pendingCommands).toBe(0);
  });
});
