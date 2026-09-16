import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { organizationFilter, siteScopedFilter } from '../../common/tenant-scope';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

/**
 * Alertas operacionais (FASE 9).
 *
 * O critério da fase é "nenhuma sessão sem estado definido" — e a forma de
 * garantir isso não é prometer que nada trava, é fazer o que travar **aparecer
 * sozinho**. Cada regra aqui é um problema que custa dinheiro ou reputação se
 * ficar invisível.
 *
 * Duas decisões de desenho:
 *
 *  1. **Avaliado na consulta, não guardado.** Alerta gravado envelhece e mente;
 *     recalculado do banco a cada olhada, reflete o agora. Com a escala do
 *     piloto (um carregador), o custo é irrelevante.
 *  2. **Sem e-mail/SMS no piloto.** Quem opera olha o painel — os alertas
 *     ficam na primeira tela (risco R-34). Canal externo entra se o piloto
 *     mostrar necessidade.
 */

export type AlertSeverity = 'CRITICAL' | 'WARNING';

export interface Alert {
  /** Código estável, para o painel agrupar e para runbook referenciar. */
  code: string;
  severity: AlertSeverity;
  /** Frase pronta, em português, dizendo O QUE está errado. */
  message: string;
  /** Onde agir — nome do runbook em docs/operations/incident-response.md. */
  runbook: string;
  entityType: 'Charger' | 'ChargingSession' | 'Payment' | 'Terminal' | 'Connector';
  entityId: string;
  /** Desde quando a condição vale, quando dá para saber. */
  since: Date | null;
}

/**
 * Limiares, em um lugar só.
 *
 * Constantes, não variáveis de ambiente: cada botão de configuração é uma
 * forma nova de errar em produção. Se o piloto mostrar que algum precisa
 * variar, ele vira configuração COM esse aprendizado, não antes.
 */
const LIMIARES = {
  /** Recarga ativa sem medição há tanto tempo = sessão zumbi. O carregador
   *  manda MeterValues a cada poucos segundos; 10 minutos calado não é atraso,
   *  é problema. */
  zumbiSemMedicaoMs: 10 * 60_000,
  /** Sessão encerrada e ainda sem valor final: o worker tenta a cada ciclo;
   *  5 minutos sem conseguir é o adquirente fora do ar ou defeito nosso. */
  cobrancaPendenteMs: 5 * 60_000,
  /** Antecedência do aviso de pré-autorização expirando (risco R-23). */
  preAutorizacaoAvisoMs: 24 * 3_600_000,
  /** Maquininha pareada que não dá sinal de vida. O aplicativo manda
   *  heartbeat; 15 minutos muda é equipamento desligado, sem rede ou furtado. */
  terminalMudoMs: 15 * 60_000,
  /** Duração acima da qual QUALQUER sessão ativa merece um olhar humano,
   *  mesmo medindo energia — não existe recarga legítima de 12 horas num
   *  carregador de 30 kW. É a rede de segurança do invariante da fase. */
  sessaoLongaMs: 12 * 3_600_000,
} as const;

const STATUS_ATIVOS = [
  'AWAITING_PAYMENT',
  'PAYMENT_APPROVED',
  'AWAITING_CHARGER',
  'COMMAND_SENT',
  'STARTING',
  'CHARGING',
  'FINISHING',
] as const;

@Injectable()
export class AlertsService {
  constructor(private readonly prisma: PrismaService) {}

  async evaluate(user: AuthenticatedUser, agora = new Date()): Promise<Alert[]> {
    const orgFilter = organizationFilter(user);
    const chargerFilter = siteScopedFilter(user);

    const [
      carregadoresOffline,
      conectoresComFalha,
      sessoesAtivas,
      cobrancasPendentes,
      reservasExpirando,
      terminaisMudos,
    ] = await Promise.all([
      /**
       * Carregador que JÁ esteve conectado e caiu. `NEVER_CONNECTED` fica de
       * fora: um cadastro aguardando instalação não é um incidente.
       */
      this.prisma.charger.findMany({
        where: { ...chargerFilter, connectionStatus: 'OFFLINE' },
        select: { id: true, name: true, lastSeenAt: true },
      }),

      this.prisma.connector.findMany({
        where: { charger: chargerFilter, status: 'FAULTED' },
        select: {
          id: true,
          connectorNumber: true,
          errorCode: true,
          lastStatusAt: true,
          charger: { select: { name: true } },
        },
      }),

      this.prisma.chargingSession.findMany({
        where: { ...orgFilter, status: { in: [...STATUS_ATIVOS] } },
        select: {
          id: true,
          status: true,
          requestedAt: true,
          startedAt: true,
          lastMeterAt: true,
          charger: { select: { name: true, connectionStatus: true } },
        },
      }),

      /**
       * Energia entregue e não cobrada (risco R-23). O worker retenta sozinho;
       * o alerta existe para o caso em que retentar não basta.
       */
      this.prisma.chargingSession.findMany({
        where: {
          ...orgFilter,
          stoppedAt: { not: null, lt: new Date(agora.getTime() - LIMIARES.cobrancaPendenteMs) },
          // Dois jeitos de uma cobrança estar pendente: a conciliação ainda não
          // fechou o valor (finalAmountCents nulo) — ou fechou, mas a captura é
          // do TERMINAL e a maquininha ainda não confirmou (pagamento parado em
          // AUTHORIZED). Sem o segundo braço, uma maquininha muda deixaria
          // energia entregue sem cobrança e nenhum alerta aceso.
          OR: [{ finalAmountCents: null }, { payment: { status: 'AUTHORIZED' } }],
        },
        select: { id: true, stoppedAt: true, charger: { select: { name: true } } },
        take: 20,
      }),

      this.prisma.payment.findMany({
        where: {
          status: 'AUTHORIZED',
          expiresAt: { lt: new Date(agora.getTime() + LIMIARES.preAutorizacaoAvisoMs) },
          session: orgFilter.organizationId
            ? { organizationId: orgFilter.organizationId }
            : { isNot: null },
        },
        select: { id: true, expiresAt: true, amountAuthorizedCents: true },
        take: 20,
      }),

      this.prisma.terminal.findMany({
        where: {
          site: chargerFilter.site ?? {},
          status: 'ACTIVE',
          tokenHash: { not: null },
          lastSeenAt: { lt: new Date(agora.getTime() - LIMIARES.terminalMudoMs) },
        },
        select: { id: true, name: true, lastSeenAt: true },
      }),
    ]);

    const alertas: Alert[] = [];

    for (const c of carregadoresOffline) {
      alertas.push({
        code: 'CARREGADOR_OFFLINE',
        severity: 'CRITICAL',
        message: `O carregador "${c.name}" está desconectado. Nenhuma recarga nova é possível nele.`,
        runbook: 'carregador-offline',
        entityType: 'Charger',
        entityId: c.id,
        since: c.lastSeenAt,
      });
    }

    for (const con of conectoresComFalha) {
      alertas.push({
        code: 'CONECTOR_COM_FALHA',
        severity: 'WARNING',
        message:
          `O conector ${con.connectorNumber} de "${con.charger.name}" reporta falha` +
          (con.errorCode ? ` (${con.errorCode}).` : '.'),
        runbook: 'conector-com-falha',
        entityType: 'Connector',
        entityId: con.id,
        since: con.lastStatusAt,
      });
    }

    for (const s of sessoesAtivas) {
      /**
       * Sessão zumbi: dizemos ao motorista que está carregando, e não temos
       * medição para provar. É o pior alerta de todos — dinheiro reservado,
       * energia desconhecida — e é EXATAMENTE o que não pode ficar invisível.
       */
      const semMedicao =
        (s.status === 'CHARGING' || s.status === 'FINISHING') &&
        (s.lastMeterAt ?? s.startedAt) !== null &&
        agora.getTime() - (s.lastMeterAt ?? s.startedAt)!.getTime() > LIMIARES.zumbiSemMedicaoMs;

      if (semMedicao) {
        alertas.push({
          code: 'SESSAO_SEM_MEDICAO',
          severity: 'CRITICAL',
          message:
            `Recarga em "${s.charger.name}" está ativa mas sem medição há mais de ` +
            `${Math.round(LIMIARES.zumbiSemMedicaoMs / 60_000)} minutos` +
            (s.charger.connectionStatus === 'OFFLINE' ? ' — e o carregador caiu.' : '.'),
          runbook: 'sessao-sem-medicao',
          entityType: 'ChargingSession',
          entityId: s.id,
          since: s.lastMeterAt ?? s.startedAt,
        });
        continue;
      }

      if (agora.getTime() - s.requestedAt.getTime() > LIMIARES.sessaoLongaMs) {
        alertas.push({
          code: 'SESSAO_LONGA_DEMAIS',
          severity: 'WARNING',
          message:
            `Sessão em "${s.charger.name}" está em ${s.status} há mais de ` +
            `${Math.round(LIMIARES.sessaoLongaMs / 3_600_000)} horas. Verifique se é real.`,
          runbook: 'sessao-presa',
          entityType: 'ChargingSession',
          entityId: s.id,
          since: s.requestedAt,
        });
      }
    }

    for (const s of cobrancasPendentes) {
      alertas.push({
        code: 'COBRANCA_PENDENTE',
        severity: 'CRITICAL',
        message:
          `Recarga encerrada em "${s.charger.name}" ainda sem valor cobrado. ` +
          'O sistema está retentando; se persistir, o adquirente pode estar fora do ar.',
        runbook: 'cobranca-pendente',
        entityType: 'ChargingSession',
        entityId: s.id,
        since: s.stoppedAt,
      });
    }

    for (const p of reservasExpirando) {
      const expirada = p.expiresAt !== null && p.expiresAt.getTime() < agora.getTime();
      alertas.push({
        code: expirada ? 'PRE_AUTORIZACAO_EXPIRADA' : 'PRE_AUTORIZACAO_EXPIRANDO',
        severity: 'CRITICAL',
        message: expirada
          ? `Uma reserva de R$ ${(p.amountAuthorizedCents / 100).toFixed(2)} EXPIROU sem captura — cobrança perdida (risco R-23).`
          : `Uma reserva de R$ ${(p.amountAuthorizedCents / 100).toFixed(2)} expira em menos de 24 h sem captura.`,
        runbook: 'pre-autorizacao-expirando',
        entityType: 'Payment',
        entityId: p.id,
        since: p.expiresAt,
      });
    }

    for (const t of terminaisMudos) {
      alertas.push({
        code: 'MAQUININHA_MUDA',
        severity: 'WARNING',
        message:
          `A maquininha "${t.name}" está sem dar sinal de vida. ` +
          'Pode estar desligada, sem rede — ou ter sido levada.',
        runbook: 'maquininha-muda',
        entityType: 'Terminal',
        entityId: t.id,
        since: t.lastSeenAt,
      });
    }

    // Crítico primeiro; dentro da severidade, o mais antigo primeiro — é o que
    // está esperando há mais tempo por alguém.
    const peso = (a: Alert) => (a.severity === 'CRITICAL' ? 0 : 1);
    return alertas.sort(
      (a, b) => peso(a) - peso(b) || (a.since?.getTime() ?? 0) - (b.since?.getTime() ?? 0),
    );
  }
}
