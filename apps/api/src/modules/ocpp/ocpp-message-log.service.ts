import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@bora/database';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Persistência de todas as mensagens OCPP.
 *
 * Critério de aceite da FASE 2: "mensagens ficam registradas". Serve a dois
 * propósitos que valem o custo de escrita:
 *
 *  1. **Diagnóstico.** Quando o WEMOB real se comportar de forma inesperada
 *     (risco R-11), o payload bruto é a única evidência do que aconteceu.
 *  2. **Idempotência.** Um carregador que retransmite o mesmo `messageId` não
 *     pode gerar duas sessões. A garantia é o índice único parcial
 *     `ocpp_messages_inbound_unique`, não uma verificação em memória.
 *
 * Nenhuma falha de log pode derrubar o processamento de uma mensagem: perder um
 * registro de diagnóstico é ruim, perder o encerramento de uma recarga paga é
 * muito pior.
 */

export interface RecordedMessage {
  id: string;
  sentAt: number;
}

/** Resultado da tentativa de registrar uma mensagem recebida. */
export type InboundRecord =
  | { status: 'new'; id: string }
  /** Já processamos esta mensagem; a resposta anterior é reaproveitada. */
  | { status: 'duplicate'; id: string; responsePayload: Prisma.JsonValue | null }
  | { status: 'unlogged' };

@Injectable()
export class OcppMessageLog {
  private readonly logger = new Logger(OcppMessageLog.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registra uma CALL recebida do carregador.
   *
   * Se o `messageId` já existir para este carregador, devolve `duplicate` com a
   * resposta que demos antes — é assim que uma retransmissão devolve o mesmo
   * `transactionId` em vez de abrir uma segunda sessão.
   */
  async recordInboundCall(input: {
    chargerId: string;
    messageId: string;
    action: string;
    payload: Record<string, unknown>;
    correlationId: string;
  }): Promise<InboundRecord> {
    try {
      const criado = await this.prisma.ocppMessage.create({
        data: {
          chargerId: input.chargerId,
          direction: 'INBOUND',
          messageType: 2,
          messageId: input.messageId,
          action: input.action,
          payload: input.payload as Prisma.InputJsonValue,
          correlationId: input.correlationId,
        },
        select: { id: true },
      });

      return { status: 'new', id: criado.id };
    } catch (error) {
      // P2002 = violação de índice único. Aqui isso NÃO é erro: é a detecção de
      // retransmissão funcionando.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const anterior = await this.prisma.ocppMessage.findFirst({
          where: {
            chargerId: input.chargerId,
            messageId: input.messageId,
            direction: 'INBOUND',
          },
          select: { id: true, responsePayload: true },
        });

        if (anterior) {
          this.logger.warn(
            { chargerId: input.chargerId, messageId: input.messageId, action: input.action },
            'mensagem OCPP retransmitida — reaproveitando a resposta anterior',
          );
          return {
            status: 'duplicate',
            id: anterior.id,
            responsePayload: anterior.responsePayload,
          };
        }
      }

      this.logger.error(
        { err: error, chargerId: input.chargerId, action: input.action },
        'falha ao registrar mensagem recebida — processamento segue sem o registro',
      );
      return { status: 'unlogged' };
    }
  }

  /** Registra uma CALL que enviamos ao carregador. */
  async recordOutboundCall(input: {
    chargerId: string;
    messageId: string;
    action: string;
    payload: Record<string, unknown>;
    correlationId: string;
  }): Promise<RecordedMessage | null> {
    try {
      const criado = await this.prisma.ocppMessage.create({
        data: {
          chargerId: input.chargerId,
          direction: 'OUTBOUND',
          messageType: 2,
          messageId: input.messageId,
          action: input.action,
          payload: input.payload as Prisma.InputJsonValue,
          correlationId: input.correlationId,
        },
        select: { id: true },
      });

      return { id: criado.id, sentAt: Date.now() };
    } catch (error) {
      this.logger.error({ err: error, action: input.action }, 'falha ao registrar comando enviado');
      return null;
    }
  }

  /** Completa um registro com a resposta recebida e o tempo de resposta. */
  async recordResponse(input: {
    id: string | undefined;
    responsePayload: Record<string, unknown>;
    processingDurationMs: number;
  }): Promise<void> {
    if (!input.id) return;

    try {
      await this.prisma.ocppMessage.update({
        where: { id: input.id },
        data: {
          responsePayload: input.responsePayload as Prisma.InputJsonValue,
          respondedAt: new Date(),
          processingDurationMs: input.processingDurationMs,
        },
      });
    } catch (error) {
      this.logger.error({ err: error }, 'falha ao registrar resposta');
    }
  }

  async recordError(input: {
    id: string | undefined;
    errorCode: string;
    errorDescription: string;
  }): Promise<void> {
    if (!input.id) return;

    try {
      await this.prisma.ocppMessage.update({
        where: { id: input.id },
        data: {
          errorCode: input.errorCode,
          errorDescription: input.errorDescription,
          respondedAt: new Date(),
        },
      });
    } catch (error) {
      this.logger.error({ err: error }, 'falha ao registrar erro de comando');
    }
  }

  /**
   * Registra uma mensagem que não conseguimos nem interpretar.
   *
   * `chargerId` pode ser nulo quando a conexão ainda não foi identificada. O
   * registro existe justamente para que uma mensagem malformada não desapareça
   * sem rastro (regra 18.4: não esconder erros).
   */
  async recordMalformed(input: {
    chargerId: string | null;
    raw: string;
    errorCode: string;
    errorDescription: string;
    correlationId: string;
  }): Promise<void> {
    try {
      await this.prisma.ocppMessage.create({
        data: {
          chargerId: input.chargerId,
          direction: 'INBOUND',
          messageType: 0, // não é 2/3/4: não foi possível determinar
          // Um id sintético evita colidir com o índice único de mensagens reais.
          messageId: `malformada-${Date.now()}-${Math.trunc(performance.now())}`,
          action: null,
          payload: { raw: input.raw.slice(0, 4000) } as Prisma.InputJsonValue,
          errorCode: input.errorCode,
          errorDescription: input.errorDescription,
          correlationId: input.correlationId,
        },
      });
    } catch (error) {
      this.logger.error({ err: error }, 'falha ao registrar mensagem malformada');
    }
  }
}
