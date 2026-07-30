import { Injectable, Logger } from '@nestjs/common';
import {
  autoStopThresholdCents,
  calculateSessionAmount,
  estimateRunningAmount,
  type PricingBreakdown,
  type TariffSnapshot,
} from '@bora/pricing';
import type { PaymentMethod } from '@bora/database';
import { PrismaService } from '../../prisma/prisma.service';
import { runtimeEnv } from '../../config/runtime-env';

/**
 * Cálculo financeiro de uma sessão, ligando o banco ao pacote `@bora/pricing`.
 *
 * A divisão é proposital: `@bora/pricing` é puro e testável sem banco; este
 * serviço só resolve **qual** tarifa e **qual** teto se aplicam. Regra de
 * arredondamento e ordem de ajustes ficam lá, não aqui.
 */

/** Tarifa e teto já resolvidos, prontos para congelar na sessão. */
export interface ResolvedTerms {
  tariffId: string | null;
  snapshot: TariffSnapshot;
  /** Teto financeiro puro (o que será pré-autorizado), em centavos. */
  preAuthCeilingCents: number;
  /**
   * Teto efetivo da sessão = menor entre o pré-autorizado e o máximo comercial
   * da tarifa (ADR-0008 §9). É o número que limita a cobrança.
   */
  ceilingAmountCents: number;
}

/**
 * Tarifa usada quando o estabelecimento ainda não cadastrou nenhuma.
 *
 * Zerada de propósito. Inventar um preço plausível seria pior: uma recarga
 * cobrada a um valor que ninguém configurou é um defeito silencioso. Com zero,
 * a sessão aparece no painel valendo R$ 0,00 e o problema fica visível.
 */
const TARIFA_AUSENTE: Omit<TariffSnapshot, 'snapshotAt'> = {
  tariffId: null,
  name: 'Sem tarifa cadastrada',
  pricePerKwhCents: 0,
  connectionFeeCents: 0,
  pricePerMinuteCents: 0,
  minimumAmountCents: 0,
  maximumAmountCents: null,
  idleFeePerMinuteCents: 0,
};

@Injectable()
export class SessionPricingService {
  private readonly logger = new Logger(SessionPricingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve tarifa e teto para uma recarga que vai começar neste conector.
   *
   * Precedência da tarifa: a do estabelecimento vence a da organização. Uma
   * tarifa específica existe justamente para sobrepor a geral.
   *
   * Precedência do teto (ADR-0008 §9):
   * carregador → estabelecimento → organização → variável de ambiente.
   */
  async resolveTerms(input: {
    connectorId: string;
    /** Teto pedido explicitamente (ex.: valor do Pix escolhido pelo motorista). */
    requestedCeilingCents?: number | null;
    at?: Date;
  }): Promise<ResolvedTerms & { organizationId: string; siteId: string; chargerId: string }> {
    const agora = input.at ?? new Date();

    const connector = await this.prisma.connector.findUniqueOrThrow({
      where: { id: input.connectorId },
      select: {
        id: true,
        chargerId: true,
        charger: {
          select: {
            siteId: true,
            preAuthCeilingCents: true,
            site: {
              select: {
                id: true,
                organizationId: true,
                preAuthCeilingCents: true,
                organization: { select: { preAuthCeilingCents: true } },
              },
            },
          },
        },
      },
    });

    const site = connector.charger.site;

    const tarifa = await this.prisma.tariff.findFirst({
      where: {
        organizationId: site.organizationId,
        status: 'ACTIVE',
        validFrom: { lte: agora },
        OR: [{ validUntil: null }, { validUntil: { gte: agora } }],
        // A do estabelecimento ou a geral da organização; nunca a de outro site.
        AND: [{ OR: [{ siteId: site.id }, { siteId: null }] }],
      },
      // `siteId desc` põe a tarifa específica antes da geral no Postgres, que
      // ordena NULL por último em ordem decrescente.
      orderBy: [{ siteId: 'desc' }, { validFrom: 'desc' }],
    });

    if (!tarifa) {
      this.logger.warn(
        { connectorId: input.connectorId, organizationId: site.organizationId },
        'nenhuma tarifa ativa encontrada — sessão será tarifada com valores zerados',
      );
    }

    const snapshot: TariffSnapshot = tarifa
      ? {
          tariffId: tarifa.id,
          name: tarifa.name,
          pricePerKwhCents: tarifa.pricePerKwhCents,
          connectionFeeCents: tarifa.connectionFeeCents,
          pricePerMinuteCents: tarifa.pricePerMinuteCents,
          minimumAmountCents: tarifa.minimumAmountCents,
          maximumAmountCents: tarifa.maximumAmountCents,
          idleFeePerMinuteCents: tarifa.idleFeePerMinuteCents,
          snapshotAt: agora.toISOString(),
        }
      : { ...TARIFA_AUSENTE, snapshotAt: agora.toISOString() };

    const preAuthCeilingCents =
      input.requestedCeilingCents ??
      connector.charger.preAuthCeilingCents ??
      site.preAuthCeilingCents ??
      site.organization.preAuthCeilingCents ??
      runtimeEnv.BORA_PREAUTH_CEILING_CENTS;

    // O teto efetivo é o MENOR dos dois. O comercial limita quanto se cobra; o
    // financeiro limita quanto se consegue cobrar. Ignorar qualquer um leva a
    // captura recusada ou a cobrança acima do combinado.
    const ceilingAmountCents =
      snapshot.maximumAmountCents === null
        ? preAuthCeilingCents
        : Math.min(preAuthCeilingCents, snapshot.maximumAmountCents);

    return {
      tariffId: tarifa?.id ?? null,
      snapshot,
      preAuthCeilingCents,
      ceilingAmountCents,
      organizationId: site.organizationId,
      siteId: site.id,
      chargerId: connector.chargerId,
    };
  }

  /**
   * Valor final da sessão, a partir do que foi congelado nela.
   *
   * Usa o snapshot gravado, e não a tarifa atual: mudar o preço amanhã não pode
   * alterar o valor de uma recarga de ontem.
   */
  finalAmount(sessao: {
    tariffSnapshot: unknown;
    energyWh: number | null;
    durationSeconds: number | null;
    ceilingAmountCents: number | null;
  }): PricingBreakdown | null {
    const snapshot = this.parseSnapshot(sessao.tariffSnapshot);
    if (!snapshot) return null;

    return calculateSessionAmount({
      snapshot,
      energyWh: sessao.energyWh ?? 0,
      durationSeconds: sessao.durationSeconds ?? 0,
      ceilingAmountCents: sessao.ceilingAmountCents,
    });
  }

  /**
   * Valor corrente de uma sessão em andamento, para o painel e para decidir a
   * parada automática.
   *
   * A duração é medida até `agora`, não até o último MeterValues: o tempo corre
   * mesmo quando o carregador está calado, e uma tarifa por minuto precisa
   * refletir isso.
   */
  runningAmount(
    sessao: {
      tariffSnapshot: unknown;
      energyWh: number | null;
      startedAt: Date | null;
      ceilingAmountCents: number | null;
    },
    agora = new Date(),
  ): number | null {
    const snapshot = this.parseSnapshot(sessao.tariffSnapshot);
    if (!snapshot) return null;

    const duracao = sessao.startedAt
      ? Math.max(0, Math.floor((agora.getTime() - sessao.startedAt.getTime()) / 1000))
      : 0;

    return estimateRunningAmount({
      snapshot,
      energyWh: sessao.energyWh ?? 0,
      durationSeconds: duracao,
      ceilingAmountCents: sessao.ceilingAmountCents,
    });
  }

  /**
   * Limiar de parada automática em centavos (ADR-0008 §4, ADR-0010 §3).
   *
   * O percentual do Pix é maior porque o incentivo se inverte: no cartão,
   * ultrapassar o teto é prejuízo nosso — o excedente não é cobrável; no Pix, o
   * valor já foi pago, e parar antes é entregar menos energia do que o motorista
   * comprou.
   */
  autoStopThreshold(ceilingAmountCents: number, method: PaymentMethod | null): number {
    const pct =
      method === 'PIX'
        ? runtimeEnv.BORA_AUTOSTOP_THRESHOLD_PIX_PCT
        : runtimeEnv.BORA_AUTOSTOP_THRESHOLD_CARD_PCT;

    return autoStopThresholdCents(ceilingAmountCents, pct);
  }

  /**
   * Lê o snapshot gravado como JSON.
   *
   * Devolve `null` — em vez de lançar — quando a sessão não tem snapshot: é o
   * caso das recargas manuais e das iniciadas no próprio carregador, que existem
   * e não podem quebrar a listagem por não terem valor a calcular.
   */
  private parseSnapshot(valor: unknown): TariffSnapshot | null {
    if (!valor || typeof valor !== 'object') return null;

    const s = valor as Partial<TariffSnapshot>;
    if (typeof s.pricePerKwhCents !== 'number') {
      this.logger.error({ snapshot: valor }, 'snapshot de tarifa malformado na sessão');
      return null;
    }

    return {
      tariffId: s.tariffId ?? null,
      name: s.name ?? 'Tarifa',
      pricePerKwhCents: s.pricePerKwhCents,
      connectionFeeCents: s.connectionFeeCents ?? 0,
      pricePerMinuteCents: s.pricePerMinuteCents ?? 0,
      minimumAmountCents: s.minimumAmountCents ?? 0,
      maximumAmountCents: s.maximumAmountCents ?? null,
      idleFeePerMinuteCents: s.idleFeePerMinuteCents ?? 0,
      snapshotAt: s.snapshotAt ?? '',
    };
  }
}
