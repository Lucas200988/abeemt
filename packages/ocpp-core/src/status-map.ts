import type { ChargePointStatusType } from './schemas';

/**
 * Tradução entre os estados do OCPP e os do nosso domínio.
 *
 * Existe para que o resto do sistema não fale OCPP. O enum do Prisma usa
 * SCREAMING_SNAKE_CASE; o OCPP usa PascalCase com nomes como `SuspendedEVSE`.
 */
export const CONNECTOR_STATUS_MAP = {
  Available: 'AVAILABLE',
  Preparing: 'PREPARING',
  Charging: 'CHARGING',
  SuspendedEV: 'SUSPENDED_EV',
  SuspendedEVSE: 'SUSPENDED_EVSE',
  Finishing: 'FINISHING',
  Reserved: 'RESERVED',
  Unavailable: 'UNAVAILABLE',
  Faulted: 'FAULTED',
} as const satisfies Record<ChargePointStatusType, string>;

export type DomainConnectorStatus =
  (typeof CONNECTOR_STATUS_MAP)[keyof typeof CONNECTOR_STATUS_MAP];

export function toDomainConnectorStatus(status: ChargePointStatusType): DomainConnectorStatus {
  return CONNECTOR_STATUS_MAP[status];
}

/**
 * Estados em que o conector aceita iniciar uma recarga (regra 11.4).
 *
 * `Preparing` conta porque é o estado do conector com veículo plugado e
 * aguardando autorização — exatamente o momento em que o RemoteStart faz sentido.
 */
export const STARTABLE_STATUSES: readonly DomainConnectorStatus[] = ['AVAILABLE', 'PREPARING'];

export function canStartCharging(status: DomainConnectorStatus): boolean {
  return STARTABLE_STATUSES.includes(status);
}

/**
 * Frases em português para o operador (briefing seção 14).
 *
 * O painel nunca deve mostrar "SuspendedEVSE" cru. O termo técnico fica na área
 * de diagnóstico.
 */
export const CONNECTOR_STATUS_LABELS: Record<DomainConnectorStatus, string> = {
  AVAILABLE: 'Disponível',
  PREPARING: 'Veículo conectado',
  CHARGING: 'Carregando',
  SUSPENDED_EV: 'Pausado pelo veículo',
  SUSPENDED_EVSE: 'Pausado pelo carregador',
  FINISHING: 'Finalizando',
  RESERVED: 'Reservado',
  UNAVAILABLE: 'Indisponível',
  FAULTED: 'Em falha',
};
