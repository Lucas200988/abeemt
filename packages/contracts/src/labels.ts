/**
 * Rótulos em português para o painel (briefing seção 14).
 *
 * A regra é não mostrar termo técnico cru para uma pessoa. O detalhe técnico
 * continua disponível na área de diagnóstico — o que não pode acontecer é o
 * operador ler "SuspendedEVSE" ou "REJECTED_BY_CHARGER" na tela principal.
 */

export const SESSION_STATUS_LABELS = {
  AWAITING_PAYMENT: 'Aguardando pagamento',
  PAYMENT_APPROVED: 'Pagamento aprovado',
  AWAITING_CHARGER: 'Aguardando carregador',
  COMMAND_SENT: 'Comando enviado',
  STARTING: 'Iniciando',
  CHARGING: 'Carregando',
  FINISHING: 'Finalizando',
  COMPLETED: 'Concluída',
  DECLINED: 'Recusada',
  CANCELLED: 'Cancelada',
  FAILED: 'Falha',
  EXPIRED: 'Expirada',
} as const;

export type SessionStatusKey = keyof typeof SESSION_STATUS_LABELS;

/** Situações em que a sessão ainda está em curso. */
export const ACTIVE_SESSION_STATUSES = [
  'AWAITING_PAYMENT',
  'PAYMENT_APPROVED',
  'AWAITING_CHARGER',
  'COMMAND_SENT',
  'STARTING',
  'CHARGING',
  'FINISHING',
] as const satisfies readonly SessionStatusKey[];

/** Situações finais: a sessão não muda mais. */
export const TERMINAL_SESSION_STATUSES = [
  'COMPLETED',
  'DECLINED',
  'CANCELLED',
  'FAILED',
  'EXPIRED',
] as const satisfies readonly SessionStatusKey[];

export function isActiveSession(status: string): boolean {
  return (ACTIVE_SESSION_STATUSES as readonly string[]).includes(status);
}

export const STOP_REASON_LABELS = {
  REMOTE_STOP: 'Encerrada pelo painel',
  LOCAL_STOP: 'Encerrada no carregador',
  EV_DISCONNECTED: 'Veículo desconectado',
  EMERGENCY_STOP: 'Parada de emergência',
  POWER_LOSS: 'Falta de energia',
  CEILING_REACHED: 'Limite do valor atingido',
  DE_AUTHORIZED: 'Autorização revogada',
  CHARGER_FAULT: 'Falha no carregador',
  COMMUNICATION_LOST: 'Comunicação perdida',
  OTHER: 'Outro motivo',
} as const;

/**
 * Estados de conector do OCPP, em português.
 *
 * O mapeamento técnico (PascalCase do OCPP → enum do domínio) fica em
 * `@bora/ocpp-core`; aqui é só a frase que vai para a tela.
 */
export const CONNECTOR_STATUS_LABELS = {
  AVAILABLE: 'Disponível',
  PREPARING: 'Veículo conectado',
  CHARGING: 'Carregando',
  SUSPENDED_EV: 'Pausado pelo veículo',
  SUSPENDED_EVSE: 'Pausado pelo carregador',
  FINISHING: 'Finalizando',
  RESERVED: 'Reservado',
  UNAVAILABLE: 'Indisponível',
  FAULTED: 'Em falha',
} as const;

export const CONNECTION_STATUS_LABELS = {
  ONLINE: 'Online',
  OFFLINE: 'Offline',
  NEVER_CONNECTED: 'Nunca conectou',
} as const;

export const OPERATIONAL_STATUS_LABELS = {
  AVAILABLE: 'Liberado',
  BLOCKED: 'Bloqueado',
  MAINTENANCE: 'Em manutenção',
} as const;

export const PAYMENT_STATUS_LABELS = {
  PENDING: 'Pendente',
  AUTHORIZED: 'Reservado',
  CAPTURED: 'Cobrado',
  PARTIALLY_REFUNDED: 'Parcialmente devolvido',
  REFUNDED: 'Devolvido',
  VOIDED: 'Reserva cancelada',
  DECLINED: 'Recusado',
  EXPIRED: 'Reserva expirada',
  FAILED: 'Falha',
} as const;

export const PAYMENT_METHOD_LABELS = {
  CREDIT_CARD: 'Cartão de crédito',
  DEBIT_CARD: 'Cartão de débito',
  PIX: 'Pix',
  MANUAL: 'Aprovação manual',
} as const;

/** Busca um rótulo com fallback para a própria chave, para nunca exibir vazio. */
export function labelOf<T extends Record<string, string>>(
  mapa: T,
  chave: string | null | undefined,
  padrao = '—',
): string {
  if (!chave) return padrao;
  return mapa[chave] ?? chave;
}
