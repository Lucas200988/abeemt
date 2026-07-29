import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MessageType, OUTBOUND_SCHEMAS, serializeCall, type OutboundAction } from '@bora/ocpp-core';
import { ConnectionRegistry } from './connection-registry';
import { OcppMessageLog } from './ocpp-message-log.service';

/** Uma chamada aguardando resposta do carregador. */
interface PendingCall {
  messageId: string;
  action: OutboundAction;
  chargePointIdentity: string;
  correlationId: string;
  sentAt: number;
  timer: NodeJS.Timeout;
  resolve: (payload: Record<string, unknown>) => void;
  reject: (error: Error) => void;
}

export type CallOutcome<T> =
  | { ok: true; payload: T; durationMs: number }
  | {
      ok: false;
      reason: 'OFFLINE' | 'TIMEOUT' | 'CALLERROR' | 'INVALID_RESPONSE';
      message: string;
      details?: unknown;
    };

export class OcppCallError extends Error {
  constructor(
    message: string,
    readonly errorCode: string,
    readonly details: unknown,
  ) {
    super(message);
    this.name = 'OcppCallError';
  }
}

export class OcppTimeoutError extends Error {
  constructor(
    readonly action: string,
    readonly timeoutMs: number,
  ) {
    super(`o carregador não respondeu ${action} em ${timeoutMs}ms`);
    this.name = 'OcppTimeoutError';
  }
}

/**
 * Envia comandos ao carregador e correlaciona as respostas.
 *
 * O OCPP não numera as respostas: a correlação é feita pelo `messageId` que nós
 * escolhemos ao enviar. Se o carregador não responder, a promessa **precisa**
 * ser encerrada por timeout — sem isso, uma sessão fica presa em
 * "comando enviado" para sempre, que é o cenário que a regra 11.5 do briefing
 * manda evitar.
 *
 * Nunca lança para o chamador: devolve um resultado descritivo. Um comando OCPP
 * que falha é um caminho esperado do negócio (carregador offline, comando
 * recusado), não uma exceção.
 */
@Injectable()
export class CallDispatcher {
  private readonly logger = new Logger(CallDispatcher.name);
  private readonly pending = new Map<string, PendingCall>();

  /** Prazo padrão. A regra 11.5 fala em 120s para o carregador aceitar o comando. */
  static readonly DEFAULT_TIMEOUT_MS = 30_000;

  constructor(
    private readonly registry: ConnectionRegistry,
    private readonly messageLog: OcppMessageLog,
  ) {}

  /**
   * Envia um comando e aguarda a resposta.
   *
   * @param correlationId permite rastrear a operação inteira nos logs (seção 13).
   */
  async call<A extends OutboundAction>(
    chargePointIdentity: string,
    action: A,
    payload: Record<string, unknown>,
    options: { timeoutMs?: number; correlationId?: string } = {},
  ): Promise<CallOutcome<Record<string, unknown>>> {
    const timeoutMs = options.timeoutMs ?? CallDispatcher.DEFAULT_TIMEOUT_MS;
    const correlationId = options.correlationId ?? randomUUID();

    const conexao = this.registry.get(chargePointIdentity);

    if (!conexao) {
      // Mensagem já em português: é o que o operador vai ler (seção 14).
      return {
        ok: false,
        reason: 'OFFLINE',
        message: 'O carregador está desconectado.',
      };
    }

    // Validamos o que ENVIAMOS de forma estrita: um payload nosso malformado é
    // bug nosso, e é melhor descobrir aqui do que pelo silêncio do carregador.
    const requestSchema = OUTBOUND_SCHEMAS[action].request;
    const validacao = requestSchema.safeParse(payload);

    if (!validacao.success) {
      this.logger.error(
        { action, payload, issues: validacao.error.issues, correlationId },
        'comando OCPP montado de forma inválida — não enviado',
      );
      return {
        ok: false,
        reason: 'INVALID_RESPONSE',
        message: 'Erro interno ao montar o comando para o carregador.',
        details: validacao.error.issues,
      };
    }

    const messageId = randomUUID();
    const raw = serializeCall(messageId, action, validacao.data as Record<string, unknown>);

    const registro = await this.messageLog.recordOutboundCall({
      chargerId: conexao.chargerId,
      messageId,
      action,
      payload: validacao.data as Record<string, unknown>,
      correlationId,
    });

    const promessa = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(messageId);
        reject(new OcppTimeoutError(action, timeoutMs));
      }, timeoutMs);

      // `unref` para que um comando pendente não segure o processo aberto no
      // encerramento da aplicação.
      timer.unref?.();

      this.pending.set(messageId, {
        messageId,
        action,
        chargePointIdentity,
        correlationId,
        sentAt: Date.now(),
        timer,
        resolve,
        reject,
      });
    });

    try {
      conexao.socket.send(raw);
    } catch (error) {
      this.cancel(messageId);
      this.logger.error({ err: error, action, correlationId }, 'falha ao escrever no socket');
      return {
        ok: false,
        reason: 'OFFLINE',
        message: 'A conexão com o carregador caiu ao enviar o comando.',
      };
    }

    this.logger.log(
      { action, messageId, correlationId, chargePointIdentity },
      'comando OCPP enviado',
    );

    try {
      const resposta = await promessa;
      const durationMs = Date.now() - (registro?.sentAt ?? Date.now());

      const responseSchema = OUTBOUND_SCHEMAS[action].response;
      const respostaValidada = responseSchema.safeParse(resposta);

      await this.messageLog.recordResponse({
        id: registro?.id,
        responsePayload: resposta,
        processingDurationMs: durationMs,
      });

      if (!respostaValidada.success) {
        // Firmware respondeu fora do padrão. Registramos o bruto para
        // diagnóstico (risco R-11) em vez de fingir que deu certo.
        this.logger.error(
          { action, resposta, issues: respostaValidada.error.issues, correlationId },
          'resposta do carregador fora do formato esperado',
        );
        return {
          ok: false,
          reason: 'INVALID_RESPONSE',
          message: 'O carregador respondeu em um formato que não reconhecemos.',
          details: resposta,
        };
      }

      return { ok: true, payload: resposta, durationMs };
    } catch (error) {
      if (error instanceof OcppTimeoutError) {
        await this.messageLog.recordError({
          id: registro?.id,
          errorCode: 'TIMEOUT',
          errorDescription: error.message,
        });

        this.logger.warn({ action, correlationId, timeoutMs }, 'comando OCPP expirou sem resposta');

        return {
          ok: false,
          reason: 'TIMEOUT',
          message: 'O carregador não respondeu ao comando dentro do tempo previsto.',
        };
      }

      if (error instanceof OcppCallError) {
        await this.messageLog.recordError({
          id: registro?.id,
          errorCode: error.errorCode,
          errorDescription: error.message,
        });

        return {
          ok: false,
          reason: 'CALLERROR',
          message: 'O carregador recusou o comando.',
          details: { errorCode: error.errorCode, description: error.message },
        };
      }

      throw error;
    }
  }

  /**
   * Entrega uma CALLRESULT recebida à chamada correspondente.
   * Devolve false se não havia chamada pendente com esse id — o que acontece
   * quando a resposta chega depois do timeout.
   */
  resolveResult(messageId: string, payload: Record<string, unknown>): boolean {
    const pendente = this.pending.get(messageId);
    if (!pendente) return false;

    clearTimeout(pendente.timer);
    this.pending.delete(messageId);
    pendente.resolve(payload);
    return true;
  }

  /** Entrega uma CALLERROR recebida à chamada correspondente. */
  resolveError(
    messageId: string,
    errorCode: string,
    errorDescription: string,
    details: unknown,
  ): boolean {
    const pendente = this.pending.get(messageId);
    if (!pendente) return false;

    clearTimeout(pendente.timer);
    this.pending.delete(messageId);
    pendente.reject(new OcppCallError(errorDescription || errorCode, errorCode, details));
    return true;
  }

  /**
   * Cancela as chamadas pendentes de um carregador que desconectou.
   *
   * Sem isso, o comando só falharia no timeout — deixando a sessão presa por
   * dezenas de segundos quando já sabemos que a resposta não vem.
   */
  cancelAllFor(chargePointIdentity: string): number {
    let cancelados = 0;

    for (const [messageId, pendente] of this.pending) {
      if (pendente.chargePointIdentity !== chargePointIdentity) continue;

      clearTimeout(pendente.timer);
      this.pending.delete(messageId);
      pendente.reject(new OcppTimeoutError(pendente.action, 0));
      cancelados += 1;
    }

    if (cancelados > 0) {
      this.logger.warn(
        { chargePointIdentity, cancelados },
        'chamadas pendentes canceladas por desconexão',
      );
    }

    return cancelados;
  }

  private cancel(messageId: string): void {
    const pendente = this.pending.get(messageId);
    if (!pendente) return;

    clearTimeout(pendente.timer);
    this.pending.delete(messageId);
  }

  /** Quantidade de comandos aguardando resposta — exposto no health check. */
  pendingCount(): number {
    return this.pending.size;
  }

  /** Detalhe dos comandos pendentes, para diagnóstico (seção 13). */
  pendingCalls(): { action: string; chargePointIdentity: string; ageMs: number }[] {
    const agora = Date.now();
    return [...this.pending.values()].map((p) => ({
      action: p.action,
      chargePointIdentity: p.chargePointIdentity,
      ageMs: agora - p.sentAt,
    }));
  }

  /** Verdadeiro se o tipo recebido é uma resposta a algo que enviamos. */
  static isResponse(type: MessageType): boolean {
    return type === MessageType.CALLRESULT || type === MessageType.CALLERROR;
  }
}
