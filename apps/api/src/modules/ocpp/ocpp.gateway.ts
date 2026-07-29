import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { verify as verifyArgon2 } from '@node-rs/argon2';
import {
  INBOUND_SCHEMAS,
  MessageType,
  OCPP_SUBPROTOCOL,
  OcppErrorCode,
  OcppParseError,
  isSupportedInboundAction,
  parseMessage,
  serializeCallError,
  serializeCallResult,
  type InboundAction,
} from '@bora/ocpp-core';
import { PrismaService } from '../../prisma/prisma.service';
import { ConnectionRegistry } from './connection-registry';
import { CallDispatcher } from './call-dispatcher';
import { OcppMessageLog } from './ocpp-message-log.service';
import { OcppHandlers, type HandlerContext } from './ocpp-handlers.service';

/**
 * Servidor WebSocket OCPP 1.6J.
 *
 * Por que `ws` cru e não o WebSocketGateway do Nest: o OCPP exige negociar o
 * subprotocolo `ocpp1.6` no handshake, extrair a identity do caminho da URL e
 * validar Basic Auth **antes** de aceitar a conexão. O adaptador do Nest não dá
 * controle sobre o upgrade, e improvisar em volta dele seria mais frágil do que
 * usar a biblioteca diretamente.
 *
 *   ws://localhost:3001/ocpp/{chargePointIdentity}
 *   wss://ocpp.sonare.com.br/ocpp/{chargePointIdentity}   (ADR-0009)
 */
@Injectable()
export class OcppGateway implements OnApplicationShutdown {
  private readonly logger = new Logger(OcppGateway.name);
  private server: WebSocketServer | null = null;

  /** Prefixo do caminho das conexões OCPP. */
  static readonly PATH_PREFIX = '/ocpp/';

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ConnectionRegistry,
    private readonly dispatcher: CallDispatcher,
    private readonly messageLog: OcppMessageLog,
    private readonly handlers: OcppHandlers,
  ) {}

  /**
   * Acopla o servidor WebSocket ao servidor HTTP existente.
   *
   * `noServer: true` porque tratamos o upgrade manualmente — é onde a
   * autenticação acontece.
   */
  attach(httpServer: HttpServer): void {
    this.server = new WebSocketServer({ noServer: true, clientTracking: true });

    httpServer.on('upgrade', (request, socket, head) => {
      void this.handleUpgrade(request, socket, head);
    });

    this.logger.log(`servidor OCPP aceitando conexões em ${OcppGateway.PATH_PREFIX}{identity}`);
  }

  onApplicationShutdown(): void {
    this.registry.closeAll();
    this.server?.close();
  }

  // -------------------------------------------------------------------------
  // Handshake
  // -------------------------------------------------------------------------

  private async handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    const url = request.url ?? '';

    // Deixa passar qualquer upgrade que não seja nosso (o Next.js em dev, por
    // exemplo, usa WebSocket para hot reload).
    if (!url.startsWith(OcppGateway.PATH_PREFIX)) return;

    const identity = decodeURIComponent(url.slice(OcppGateway.PATH_PREFIX.length).split('?')[0]);

    if (!identity) {
      this.rejectUpgrade(socket, 400, 'identity ausente no caminho');
      return;
    }

    // O subprotocolo é obrigatório no OCPP-J. Aceitar sem ele deixaria passar
    // cliente que não fala o protocolo, e o erro apareceria só na primeira
    // mensagem — bem mais difícil de diagnosticar.
    const oferecidos = (request.headers['sec-websocket-protocol'] ?? '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);

    if (oferecidos.length > 0 && !oferecidos.includes(OCPP_SUBPROTOCOL)) {
      this.logger.warn(
        { identity, oferecidos },
        'conexão recusada: subprotocolo ocpp1.6 não oferecido',
      );
      this.rejectUpgrade(socket, 400, 'subprotocolo ocpp1.6 obrigatorio');
      return;
    }

    const charger = await this.prisma.charger.findUnique({
      where: { chargePointIdentity: identity },
      select: {
        id: true,
        credentialsHash: true,
        operationalStatus: true,
        site: { select: { status: true } },
      },
    });

    if (!charger) {
      this.logger.warn({ identity }, 'conexão recusada: carregador não cadastrado');
      this.rejectUpgrade(socket, 404, 'carregador nao cadastrado');
      return;
    }

    if (charger.site.status !== 'ACTIVE') {
      this.logger.warn({ identity }, 'conexão recusada: estabelecimento inativo');
      this.rejectUpgrade(socket, 403, 'estabelecimento inativo');
      return;
    }

    // Credencial individual por carregador (briefing seção 12). Quando o
    // carregador não tem credencial cadastrada, aceitamos sem autenticação —
    // necessário para o simulador e para o primeiro contato com o WEMOB, que
    // pode não suportar Basic Auth (premissa E4, ainda não confirmada).
    if (charger.credentialsHash) {
      const autenticado = await this.verifyBasicAuth(request, identity, charger.credentialsHash);

      if (!autenticado) {
        this.logger.warn({ identity }, 'conexão recusada: credencial inválida');
        this.rejectUpgrade(socket, 401, 'credencial invalida');
        return;
      }
    }

    if (!this.server) {
      this.rejectUpgrade(socket, 503, 'servidor ocpp indisponivel');
      return;
    }

    this.server.handleUpgrade(request, socket, head, (ws) => {
      this.onConnection(ws, identity, charger.id, request);
    });
  }

  /**
   * Valida Basic Auth do handshake.
   *
   * O OCPP 1.6 especifica o usuário como sendo a própria identity do carregador.
   * A comparação do usuário usa `timingSafeEqual` para não vazar informação pelo
   * tempo de resposta.
   */
  private async verifyBasicAuth(
    request: IncomingMessage,
    identity: string,
    credentialsHash: string,
  ): Promise<boolean> {
    const header = request.headers.authorization;

    if (!header?.startsWith('Basic ')) return false;

    let decoded: string;
    try {
      decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    } catch {
      return false;
    }

    const separador = decoded.indexOf(':');
    if (separador < 0) return false;

    const usuario = decoded.slice(0, separador);
    const senha = decoded.slice(separador + 1);

    const esperado = Buffer.from(identity);
    const recebido = Buffer.from(usuario);

    if (esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) {
      return false;
    }

    try {
      return await verifyArgon2(credentialsHash, senha);
    } catch {
      return false;
    }
  }

  private rejectUpgrade(socket: Duplex, status: number, reason: string): void {
    const mensagens: Record<number, string> = {
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      503: 'Service Unavailable',
    };

    socket.write(
      `HTTP/1.1 ${status} ${mensagens[status] ?? 'Error'}\r\n` +
        `Content-Length: 0\r\n` +
        `X-Reason: ${reason}\r\n` +
        `Connection: close\r\n\r\n`,
    );
    socket.destroy();
  }

  // -------------------------------------------------------------------------
  // Ciclo de vida da conexão
  // -------------------------------------------------------------------------

  private onConnection(
    socket: WebSocket,
    identity: string,
    chargerId: string,
    request: IncomingMessage,
  ): void {
    this.registry.register(identity, chargerId, socket);

    this.logger.log(
      { chargePointIdentity: identity, chargerId, ip: request.socket.remoteAddress },
      'carregador conectado',
    );

    // O estado de conexão vai para o banco: o painel não pode depender de
    // consultar a memória de um processo específico (ADR-0006).
    void this.marcarConexao(chargerId, 'ONLINE');

    socket.on('message', (data) => {
      const raw = typeof data === 'string' ? data : data.toString('utf8');

      // Serializado por conexão: MeterValues não pode ser processado antes do
      // StartTransaction que o precede ter sido gravado.
      this.registry.enqueue(identity, () =>
        this.processarMensagem(raw, identity, chargerId, socket),
      );
    });

    socket.on('close', (code, motivo) => {
      const removido = this.registry.unregister(identity, socket);

      // Só reagimos se este era o socket ativo: o `close` de um socket antigo,
      // que chega depois da reconexão, não pode marcar o carregador offline.
      if (!removido) return;

      this.dispatcher.cancelAllFor(identity);
      void this.marcarConexao(chargerId, 'OFFLINE');

      this.logger.warn(
        { chargePointIdentity: identity, chargerId, code, motivo: motivo.toString() },
        'carregador desconectado',
      );
    });

    socket.on('error', (error) => {
      this.logger.error(
        { err: error, chargePointIdentity: identity },
        'erro no socket do carregador',
      );
    });

    // Ping periódico para detectar conexão morta que o TCP ainda não fechou —
    // caso comum em 4G, onde o socket fica "vivo" por minutos após a queda.
    const pingTimer = setInterval(() => {
      if (socket.readyState === socket.OPEN) socket.ping();
    }, 60_000);
    pingTimer.unref?.();

    socket.on('close', () => clearInterval(pingTimer));
  }

  private async marcarConexao(chargerId: string, status: 'ONLINE' | 'OFFLINE'): Promise<void> {
    try {
      await this.prisma.charger.update({
        where: { id: chargerId },
        data: {
          connectionStatus: status,
          ...(status === 'ONLINE' ? { lastSeenAt: new Date() } : {}),
        },
      });
    } catch (error) {
      this.logger.error({ err: error, chargerId, status }, 'falha ao atualizar estado de conexão');
    }
  }

  // -------------------------------------------------------------------------
  // Processamento de mensagens
  // -------------------------------------------------------------------------

  private async processarMensagem(
    raw: string,
    identity: string,
    chargerId: string,
    socket: WebSocket,
  ): Promise<void> {
    const correlationId = randomUUID();
    const receivedAt = new Date();

    let mensagem;
    try {
      mensagem = parseMessage(raw);
    } catch (error) {
      if (error instanceof OcppParseError) {
        await this.messageLog.recordMalformed({
          chargerId,
          raw,
          errorCode: error.errorCode,
          errorDescription: error.message,
          correlationId,
        });

        this.logger.warn(
          { chargePointIdentity: identity, erro: error.message, correlationId },
          'mensagem OCPP malformada',
        );

        // Sem messageId legível não há a quem correlacionar a resposta.
        if (error.messageId) {
          this.enviar(socket, serializeCallError(error.messageId, error.errorCode, error.message));
        }
        return;
      }
      throw error;
    }

    // Resposta a um comando nosso.
    if (mensagem.type === MessageType.CALLRESULT) {
      if (!this.dispatcher.resolveResult(mensagem.messageId, mensagem.payload)) {
        this.logger.warn(
          { chargePointIdentity: identity, messageId: mensagem.messageId },
          'CALLRESULT sem comando pendente (provavelmente resposta após timeout)',
        );
      }
      return;
    }

    if (mensagem.type === MessageType.CALLERROR) {
      if (
        !this.dispatcher.resolveError(
          mensagem.messageId,
          mensagem.errorCode,
          mensagem.errorDescription,
          mensagem.errorDetails,
        )
      ) {
        this.logger.warn(
          { chargePointIdentity: identity, messageId: mensagem.messageId },
          'CALLERROR sem comando pendente',
        );
      }
      return;
    }

    // CALL: requisição do carregador.
    const { messageId, action, payload } = mensagem;

    if (!isSupportedInboundAction(action)) {
      this.logger.warn({ chargePointIdentity: identity, action }, 'ação OCPP não suportada');
      this.enviar(
        socket,
        serializeCallError(
          messageId,
          OcppErrorCode.NotImplemented,
          `ação não suportada: ${action}`,
        ),
      );
      return;
    }

    const validacao = INBOUND_SCHEMAS[action].safeParse(payload);

    if (!validacao.success) {
      await this.messageLog.recordMalformed({
        chargerId,
        raw,
        errorCode: OcppErrorCode.TypeConstraintViolation,
        errorDescription: JSON.stringify(validacao.error.issues).slice(0, 500),
        correlationId,
      });

      this.logger.warn(
        { chargePointIdentity: identity, action, issues: validacao.error.issues, correlationId },
        'payload OCPP inválido',
      );

      this.enviar(
        socket,
        serializeCallError(
          messageId,
          OcppErrorCode.TypeConstraintViolation,
          'payload inválido para a ação',
        ),
      );
      return;
    }

    // Registro + deduplicação. Uma retransmissão do mesmo messageId devolve a
    // resposta anterior, sem executar o handler de novo (regra 11.3, risco R-08).
    const registro = await this.messageLog.recordInboundCall({
      chargerId,
      messageId,
      action,
      payload,
      correlationId,
    });

    if (registro.status === 'duplicate') {
      if (registro.responsePayload) {
        this.enviar(
          socket,
          serializeCallResult(messageId, registro.responsePayload as Record<string, unknown>),
        );
      } else {
        // Duplicata de mensagem que ainda não terminou de processar: responder
        // erro é melhor do que executar de novo e criar sessão duplicada.
        this.enviar(
          socket,
          serializeCallError(messageId, OcppErrorCode.InternalError, 'mensagem em processamento'),
        );
      }
      return;
    }

    const ctx: HandlerContext = {
      chargerId,
      chargePointIdentity: identity,
      correlationId,
      receivedAt,
    };

    const iniciado = Date.now();

    try {
      const resposta = await this.executar(action, validacao.data, ctx);

      this.enviar(socket, serializeCallResult(messageId, resposta));

      if (registro.status === 'new') {
        await this.messageLog.recordResponse({
          id: registro.id,
          responsePayload: resposta,
          processingDurationMs: Date.now() - iniciado,
        });
      }
    } catch (error) {
      // Erro no handler não pode virar silêncio: o carregador ficaria esperando
      // indefinidamente (regra 18.4).
      this.logger.error(
        { err: error, chargePointIdentity: identity, action, correlationId },
        'falha ao processar mensagem OCPP',
      );

      if (registro.status === 'new') {
        await this.messageLog.recordError({
          id: registro.id,
          errorCode: OcppErrorCode.InternalError,
          errorDescription: error instanceof Error ? error.message : 'erro desconhecido',
        });
      }

      this.enviar(
        socket,
        serializeCallError(messageId, OcppErrorCode.InternalError, 'erro interno ao processar'),
      );
    }
  }

  /** Roteia a ação para o handler correspondente. */
  private executar(
    action: InboundAction,
    payload: unknown,
    ctx: HandlerContext,
  ): Promise<Record<string, unknown>> {
    switch (action) {
      case 'BootNotification':
        return this.handlers.bootNotification(payload as never, ctx);
      case 'Heartbeat':
        return this.handlers.heartbeat(ctx);
      case 'StatusNotification':
        return this.handlers.statusNotification(payload as never, ctx);
      case 'Authorize':
        return this.handlers.authorize(payload as never, ctx);
      case 'StartTransaction':
        return this.handlers.startTransaction(payload as never, ctx);
      case 'StopTransaction':
        return this.handlers.stopTransaction(payload as never, ctx);
      case 'MeterValues':
        return this.handlers.meterValues(payload as never, ctx);
    }
  }

  private enviar(socket: WebSocket, raw: string): void {
    if (socket.readyState !== socket.OPEN) {
      this.logger.warn('tentativa de enviar mensagem em socket fechado');
      return;
    }

    socket.send(raw);
  }
}
