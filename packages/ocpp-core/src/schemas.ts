import { z } from 'zod';

/**
 * Esquemas dos payloads OCPP 1.6 que o MVP implementa.
 *
 * Regra adotada: **estrito na saída, tolerante na entrada.** Campos
 * obrigatórios são exigidos, mas campos extras não derrubam a mensagem — o
 * briefing (regra 18.20) avisa que carregadores não implementam OCPP da mesma
 * forma, e recusar um `StopTransaction` porque o firmware mandou um campo a mais
 * significaria perder o encerramento de uma recarga paga.
 *
 * O que chega a mais fica registrado no payload bruto do `OcppMessage`, para
 * diagnóstico.
 */

/** CiString com limite de tamanho, como o OCPP define. */
const ciString = (max: number) => z.string().min(1).max(max);

/**
 * Timestamp do OCPP. Alguns firmwares mandam sem timezone; aceitamos e
 * interpretamos como UTC em vez de recusar a mensagem.
 */
export const ocppDateTime = z.string().transform((value, ctx) => {
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`;
  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) {
    ctx.addIssue({ code: 'custom', message: `data/hora inválida: ${value}` });
    return z.NEVER;
  }

  return date;
});

// ---------------------------------------------------------------------------
// Enums do protocolo
// ---------------------------------------------------------------------------

export const RegistrationStatus = z.enum(['Accepted', 'Pending', 'Rejected']);

export const AuthorizationStatus = z.enum([
  'Accepted',
  'Blocked',
  'Expired',
  'Invalid',
  'ConcurrentTx',
]);

export const ChargePointStatus = z.enum([
  'Available',
  'Preparing',
  'Charging',
  'SuspendedEV',
  'SuspendedEVSE',
  'Finishing',
  'Reserved',
  'Unavailable',
  'Faulted',
]);

export const ChargePointErrorCode = z.enum([
  'ConnectorLockFailure',
  'EVCommunicationError',
  'GroundFailure',
  'HighTemperature',
  'InternalError',
  'LocalListConflict',
  'NoError',
  'OtherError',
  'OverCurrentFailure',
  'OverVoltage',
  'PowerMeterFailure',
  'PowerSwitchFailure',
  'ReaderFailure',
  'ResetFailure',
  'UnderVoltage',
  'WeakSignal',
]);

export const StopReasonSchema = z.enum([
  'DeAuthorized',
  'EmergencyStop',
  'EVDisconnected',
  'HardReset',
  'Local',
  'Other',
  'PowerLoss',
  'Reboot',
  'Remote',
  'SoftReset',
  'UnlockCommand',
]);

export const RemoteStartStopStatus = z.enum(['Accepted', 'Rejected']);

// ---------------------------------------------------------------------------
// Entrada: mensagens que o carregador envia
// ---------------------------------------------------------------------------

export const BootNotificationRequest = z.object({
  chargePointVendor: ciString(20),
  chargePointModel: ciString(20),
  chargePointSerialNumber: z.string().max(25).optional(),
  chargeBoxSerialNumber: z.string().max(25).optional(),
  firmwareVersion: z.string().max(50).optional(),
  iccid: z.string().max(20).optional(),
  imsi: z.string().max(20).optional(),
  meterType: z.string().max(25).optional(),
  meterSerialNumber: z.string().max(25).optional(),
});

export const HeartbeatRequest = z.object({});

export const StatusNotificationRequest = z.object({
  connectorId: z.number().int().min(0),
  errorCode: ChargePointErrorCode,
  status: ChargePointStatus,
  info: z.string().max(50).optional(),
  timestamp: ocppDateTime.optional(),
  vendorId: z.string().max(255).optional(),
  vendorErrorCode: z.string().max(50).optional(),
});

export const AuthorizeRequest = z.object({
  idTag: ciString(20),
});

export const StartTransactionRequest = z.object({
  connectorId: z.number().int().positive(),
  idTag: ciString(20),
  meterStart: z.number().int(),
  timestamp: ocppDateTime,
  reservationId: z.number().int().optional(),
});

export const StopTransactionRequest = z.object({
  transactionId: z.number().int(),
  meterStop: z.number().int(),
  timestamp: ocppDateTime,
  idTag: z.string().max(20).optional(),
  reason: StopReasonSchema.optional(),
  // transactionData chega como estrutura aninhada de MeterValue; guardamos
  // bruto e processamos depois, para não recusar a mensagem por detalhe de
  // formato num campo opcional.
  transactionData: z.array(z.unknown()).optional(),
});

/** Um valor medido dentro de um MeterValue. */
export const SampledValue = z.object({
  value: z.string(),
  context: z.string().optional(),
  format: z.string().optional(),
  measurand: z.string().optional(),
  phase: z.string().optional(),
  location: z.string().optional(),
  unit: z.string().optional(),
});

export const MeterValueEntry = z.object({
  timestamp: ocppDateTime,
  sampledValue: z.array(SampledValue),
});

export const MeterValuesRequest = z.object({
  connectorId: z.number().int().min(0),
  transactionId: z.number().int().optional(),
  meterValue: z.array(MeterValueEntry),
});

// ---------------------------------------------------------------------------
// Saída: mensagens que enviamos ao carregador
// ---------------------------------------------------------------------------

export const RemoteStartTransactionRequest = z.object({
  idTag: ciString(20),
  connectorId: z.number().int().positive().optional(),
});

export const RemoteStopTransactionRequest = z.object({
  transactionId: z.number().int(),
});

export const RemoteStartTransactionResponse = z.object({
  status: RemoteStartStopStatus,
});

export const RemoteStopTransactionResponse = z.object({
  status: RemoteStartStopStatus,
});

// ---------------------------------------------------------------------------
// Registro de ações suportadas
// ---------------------------------------------------------------------------

/** Ações que aceitamos receber. Qualquer outra vira CALLERROR NotImplemented. */
export const INBOUND_SCHEMAS = {
  BootNotification: BootNotificationRequest,
  Heartbeat: HeartbeatRequest,
  StatusNotification: StatusNotificationRequest,
  Authorize: AuthorizeRequest,
  StartTransaction: StartTransactionRequest,
  StopTransaction: StopTransactionRequest,
  MeterValues: MeterValuesRequest,
} as const;

export type InboundAction = keyof typeof INBOUND_SCHEMAS;

export function isSupportedInboundAction(action: string): action is InboundAction {
  return Object.prototype.hasOwnProperty.call(INBOUND_SCHEMAS, action);
}

/** Ações que enviamos ao carregador. */
export const OUTBOUND_SCHEMAS = {
  RemoteStartTransaction: {
    request: RemoteStartTransactionRequest,
    response: RemoteStartTransactionResponse,
  },
  RemoteStopTransaction: {
    request: RemoteStopTransactionRequest,
    response: RemoteStopTransactionResponse,
  },
} as const;

export type OutboundAction = keyof typeof OUTBOUND_SCHEMAS;

export type BootNotificationRequestType = z.infer<typeof BootNotificationRequest>;
export type StatusNotificationRequestType = z.infer<typeof StatusNotificationRequest>;
export type AuthorizeRequestType = z.infer<typeof AuthorizeRequest>;
export type StartTransactionRequestType = z.infer<typeof StartTransactionRequest>;
export type StopTransactionRequestType = z.infer<typeof StopTransactionRequest>;
export type MeterValuesRequestType = z.infer<typeof MeterValuesRequest>;
export type SampledValueType = z.infer<typeof SampledValue>;
export type ChargePointStatusType = z.infer<typeof ChargePointStatus>;
