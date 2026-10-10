/**
 * Camada de transporte do OCPP 1.6J.
 *
 * Só o envelope das mensagens vive aqui — nada de regra de negócio, nada de I/O.
 * Isso é de propósito: o formato do protocolo é a parte que precisa estar
 * exaustivamente testada, e testar coisa pura é barato.
 *
 * Referência: OCPP 1.6 JSON, seção "Message structure".
 *
 *   CALL:       [2, "messageId", "Action", { payload }]
 *   CALLRESULT: [3, "messageId", { payload }]
 *   CALLERROR:  [4, "messageId", "errorCode", "errorDescription", { details }]
 *
 * A regra 18.19 do briefing manda não confiar em biblioteca OCPP sem testes.
 * Por isso o protocolo é implementado aqui, e não delegado.
 */

export const OCPP_SUBPROTOCOL = 'ocpp1.6';

export enum MessageType {
  CALL = 2,
  CALLRESULT = 3,
  CALLERROR = 4,
}

/** Códigos de erro do OCPP 1.6, seção 4.2.3. */
export const OcppErrorCode = {
  NotImplemented: 'NotImplemented',
  NotSupported: 'NotSupported',
  InternalError: 'InternalError',
  ProtocolError: 'ProtocolError',
  SecurityError: 'SecurityError',
  FormationViolation: 'FormationViolation',
  PropertyConstraintViolation: 'PropertyConstraintViolation',
  OccurenceConstraintViolation: 'OccurenceConstraintViolation',
  TypeConstraintViolation: 'TypeConstraintViolation',
  GenericError: 'GenericError',
} as const;

export type OcppErrorCode = (typeof OcppErrorCode)[keyof typeof OcppErrorCode];

export interface OcppCall {
  type: MessageType.CALL;
  messageId: string;
  action: string;
  payload: Record<string, unknown>;
}

export interface OcppCallResult {
  type: MessageType.CALLRESULT;
  messageId: string;
  payload: Record<string, unknown>;
}

export interface OcppCallError {
  type: MessageType.CALLERROR;
  messageId: string;
  errorCode: string;
  errorDescription: string;
  errorDetails: Record<string, unknown>;
}

export type OcppMessage = OcppCall | OcppCallResult | OcppCallError;

/**
 * Erro de parsing que já carrega o código OCPP a devolver.
 *
 * O `messageId` pode ser nulo: se a mensagem estiver tão malformada que nem o
 * id é legível, não há para quem responder — e aí o certo é registrar e ignorar,
 * não inventar um id.
 */
export class OcppParseError extends Error {
  constructor(
    message: string,
    readonly errorCode: OcppErrorCode,
    readonly messageId: string | null = null,
  ) {
    super(message);
    this.name = 'OcppParseError';
  }
}

/** Limite do campo uniqueId no OCPP 1.6 (CiString36). */
const MAX_MESSAGE_ID_LENGTH = 36;

/**
 * Converte o texto recebido no WebSocket em uma mensagem OCPP.
 *
 * Lança `OcppParseError` com o código correto para cada tipo de violação —
 * quem chama só precisa repassar o código na CALLERROR.
 */
export function parseMessage(raw: string): OcppMessage {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new OcppParseError('JSON inválido', OcppErrorCode.FormationViolation);
  }

  if (!Array.isArray(parsed)) {
    throw new OcppParseError('A mensagem precisa ser um array JSON', OcppErrorCode.ProtocolError);
  }

  if (parsed.length < 3) {
    throw new OcppParseError(
      'A mensagem precisa ter ao menos 3 elementos',
      OcppErrorCode.ProtocolError,
    );
  }

  const [rawType, rawMessageId] = parsed as [unknown, unknown];

  // O messageId é lido antes de qualquer outra validação: sem ele não há como
  // responder um erro ao carregador.
  const messageId = typeof rawMessageId === 'string' ? rawMessageId : null;

  if (messageId === null) {
    throw new OcppParseError('messageId ausente ou não textual', OcppErrorCode.ProtocolError);
  }

  if (messageId.length === 0 || messageId.length > MAX_MESSAGE_ID_LENGTH) {
    throw new OcppParseError(
      `messageId precisa ter entre 1 e ${MAX_MESSAGE_ID_LENGTH} caracteres`,
      OcppErrorCode.ProtocolError,
      messageId.slice(0, MAX_MESSAGE_ID_LENGTH),
    );
  }

  if (
    rawType !== MessageType.CALL &&
    rawType !== MessageType.CALLRESULT &&
    rawType !== MessageType.CALLERROR
  ) {
    throw new OcppParseError(
      `Tipo de mensagem desconhecido: ${String(rawType)}`,
      OcppErrorCode.ProtocolError,
      messageId,
    );
  }

  switch (rawType) {
    case MessageType.CALL: {
      const [, , action, payload] = parsed as [number, string, unknown, unknown];

      if (typeof action !== 'string' || action.length === 0) {
        throw new OcppParseError(
          'Action ausente ou não textual',
          OcppErrorCode.ProtocolError,
          messageId,
        );
      }

      // Payload ausente é tolerado como objeto vazio: várias ações do OCPP 1.6
      // têm payload vazio, e firmwares divergem entre `{}` e omitir o campo.
      if (payload !== undefined && !isPlainObject(payload)) {
        throw new OcppParseError(
          'O payload precisa ser um objeto',
          OcppErrorCode.ProtocolError,
          messageId,
        );
      }

      return {
        type: MessageType.CALL,
        messageId,
        action,
        payload: (payload as Record<string, unknown> | undefined) ?? {},
      };
    }

    case MessageType.CALLRESULT: {
      const [, , payload] = parsed as [number, string, unknown];

      if (payload !== undefined && !isPlainObject(payload)) {
        throw new OcppParseError(
          'O payload precisa ser um objeto',
          OcppErrorCode.ProtocolError,
          messageId,
        );
      }

      return {
        type: MessageType.CALLRESULT,
        messageId,
        payload: (payload as Record<string, unknown> | undefined) ?? {},
      };
    }

    case MessageType.CALLERROR: {
      const [, , errorCode, errorDescription, errorDetails] = parsed as [
        number,
        string,
        unknown,
        unknown,
        unknown,
      ];

      if (typeof errorCode !== 'string') {
        throw new OcppParseError('errorCode ausente', OcppErrorCode.ProtocolError, messageId);
      }

      return {
        type: MessageType.CALLERROR,
        messageId,
        errorCode,
        errorDescription: typeof errorDescription === 'string' ? errorDescription : '',
        errorDetails: isPlainObject(errorDetails) ? (errorDetails as Record<string, unknown>) : {},
      };
    }
  }
}

export function serializeCall(
  messageId: string,
  action: string,
  payload: Record<string, unknown>,
): string {
  return JSON.stringify([MessageType.CALL, messageId, action, payload]);
}

export function serializeCallResult(messageId: string, payload: Record<string, unknown>): string {
  return JSON.stringify([MessageType.CALLRESULT, messageId, payload]);
}

export function serializeCallError(
  messageId: string,
  errorCode: OcppErrorCode | string,
  errorDescription = '',
  errorDetails: Record<string, unknown> = {},
): string {
  return JSON.stringify([
    MessageType.CALLERROR,
    messageId,
    errorCode,
    errorDescription,
    errorDetails,
  ]);
}

/** Array e null não contam como objeto de payload. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Data e hora no formato que o OCPP espera (ISO 8601 em UTC).
 *
 * Recebe a data por parâmetro em vez de chamar `new Date()` internamente para
 * que os testes possam fixar o instante.
 */
export function ocppTimestamp(date: Date): string {
  return date.toISOString();
}
