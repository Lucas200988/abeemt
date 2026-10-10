import { Injectable } from '@nestjs/common';
import { SESSION_STATUS_LABELS, labelOf } from '@bora/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { ConnectionRegistry } from '../ocpp/connection-registry';
import { CallDispatcher } from '../ocpp/call-dispatcher';
import { organizationFilter, siteScopedFilter } from '../../common/tenant-scope';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

export interface DashboardOverview {
  chargers: {
    total: number;
    online: number;
    offline: number;
    charging: number;
    blocked: number;
    faulted: number;
  };
  today: {
    energyWh: number;
    receivedCents: number;
    sessionsStarted: number;
    sessionsCompleted: number;
  };
  activeSessions: {
    id: string;
    chargerName: string;
    connectorNumber: number;
    status: string;
    statusLabel: string;
    startedAt: Date | null;
    energyWh: number | null;
  }[];
  recentSessions: {
    id: string;
    chargerName: string;
    status: string;
    statusLabel: string;
    requestedAt: Date;
    energyWh: number | null;
    finalAmountCents: number | null;
  }[];
  recentFailures: {
    id: string;
    chargerName: string;
    status: string;
    statusLabel: string;
    failureReason: string | null;
    requestedAt: Date;
  }[];
  ocpp: {
    connectedNow: number;
    pendingCommands: number;
  };
  /** Início do dia usado no cálculo, para o painel exibir o recorte. */
  dayStartedAt: Date;
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ConnectionRegistry,
    private readonly dispatcher: CallDispatcher,
  ) {}

  async overview(user: AuthenticatedUser, timezone = 'America/Cuiaba'): Promise<DashboardOverview> {
    const orgFilter = organizationFilter(user);
    const chargerFilter = siteScopedFilter(user);
    const inicioDoDia = this.inicioDoDia(new Date(), timezone);

    const [
      totalChargers,
      online,
      blocked,
      chargingConnectors,
      faultedConnectors,
      sessoesAtivas,
      recentes,
      falhas,
      agregadoHoje,
      iniciadasHoje,
    ] = await Promise.all([
      this.prisma.charger.count({ where: chargerFilter }),
      this.prisma.charger.count({ where: { ...chargerFilter, connectionStatus: 'ONLINE' } }),
      this.prisma.charger.count({ where: { ...chargerFilter, operationalStatus: 'BLOCKED' } }),
      this.prisma.connector.count({
        where: { charger: chargerFilter, status: 'CHARGING' },
      }),
      this.prisma.connector.count({
        where: { charger: chargerFilter, status: 'FAULTED' },
      }),
      this.prisma.chargingSession.findMany({
        where: {
          ...orgFilter,
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
        include: {
          charger: { select: { name: true } },
          connector: { select: { connectorNumber: true } },
        },
        orderBy: { requestedAt: 'desc' },
        take: 20,
      }),
      this.prisma.chargingSession.findMany({
        where: orgFilter,
        include: { charger: { select: { name: true } } },
        orderBy: { requestedAt: 'desc' },
        take: 10,
      }),
      this.prisma.chargingSession.findMany({
        where: {
          ...orgFilter,
          status: { in: ['FAILED', 'DECLINED', 'EXPIRED'] },
        },
        include: { charger: { select: { name: true } } },
        orderBy: { requestedAt: 'desc' },
        take: 10,
      }),
      // Energia e valor do dia vêm de sessões CONCLUÍDAS: somar sessão em curso
      // daria um número que sobe e desce conforme as sessões terminam.
      this.prisma.chargingSession.aggregate({
        where: { ...orgFilter, status: 'COMPLETED', stoppedAt: { gte: inicioDoDia } },
        _sum: { energyWh: true, finalAmountCents: true },
        _count: true,
      }),
      this.prisma.chargingSession.count({
        where: { ...orgFilter, requestedAt: { gte: inicioDoDia } },
      }),
    ]);

    return {
      chargers: {
        total: totalChargers,
        online,
        offline: totalChargers - online,
        charging: chargingConnectors,
        blocked,
        faulted: faultedConnectors,
      },
      today: {
        energyWh: agregadoHoje._sum.energyWh ?? 0,
        receivedCents: agregadoHoje._sum.finalAmountCents ?? 0,
        sessionsStarted: iniciadasHoje,
        sessionsCompleted: agregadoHoje._count,
      },
      activeSessions: sessoesAtivas.map((s) => ({
        id: s.id,
        chargerName: s.charger.name,
        connectorNumber: s.connector.connectorNumber,
        status: s.status,
        statusLabel: labelOf(SESSION_STATUS_LABELS, s.status),
        startedAt: s.startedAt,
        energyWh: s.energyWh,
      })),
      recentSessions: recentes.map((s) => ({
        id: s.id,
        chargerName: s.charger.name,
        status: s.status,
        statusLabel: labelOf(SESSION_STATUS_LABELS, s.status),
        requestedAt: s.requestedAt,
        energyWh: s.energyWh,
        finalAmountCents: s.finalAmountCents,
      })),
      recentFailures: falhas.map((s) => ({
        id: s.id,
        chargerName: s.charger.name,
        status: s.status,
        statusLabel: labelOf(SESSION_STATUS_LABELS, s.status),
        failureReason: s.failureReason,
        requestedAt: s.requestedAt,
      })),
      ocpp: {
        connectedNow: this.registry.count(),
        pendingCommands: this.dispatcher.pendingCount(),
      },
      dayStartedAt: inicioDoDia,
    };
  }

  /**
   * Meia-noite no fuso do estabelecimento.
   *
   * Usar UTC daria "hoje" errado por 4 horas em Mato Grosso — um relatório
   * diário que muda de dia às 20h não serve para ninguém.
   */
  private inicioDoDia(agora: Date, timeZone: string): Date {
    const partes = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(agora);

    const get = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '00';
    const dataLocal = `${get('year')}-${get('month')}-${get('day')}`;

    // Descobre o deslocamento do fuso naquele instante, para converter a
    // meia-noite local em UTC sem depender de biblioteca de datas.
    const comoUtc = new Date(`${dataLocal}T00:00:00Z`);
    const deslocamentoMs = comoUtc.getTime() - this.instantePara(dataLocal, timeZone);

    return new Date(comoUtc.getTime() + deslocamentoMs);
  }

  private instantePara(dataLocal: string, timeZone: string): number {
    const referencia = new Date(`${dataLocal}T00:00:00Z`);
    const formatado = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(referencia);

    // "MM/DD/YYYY, HH:mm:ss" → timestamp interpretado como UTC
    const [data, hora] = formatado.split(', ');
    const [mes, dia, ano] = data.split('/');
    return new Date(`${ano}-${mes}-${dia}T${hora}Z`).getTime();
  }
}
