import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { calculateSessionAmount, type PricingBreakdown, type TariffSnapshot } from '@bora/pricing';
import { Prisma } from '@bora/database';
import { PrismaService } from '../../prisma/prisma.service';
import {
  assertSameOrganization,
  organizationFilter,
  organizationForCreate,
} from '../../common/tenant-scope';
import { paginated, type Paginated, type PaginationDto } from '../../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import type { CreateTariffDto, SimulateTariffDto, UpdateTariffDto } from './dto/tariff.dto';

/**
 * Gestão de tarifas (FASE 6).
 *
 * Duas regras atravessam tudo aqui:
 *
 *  1. **Tarifa não se apaga.** Desativar mantém o histórico; apagar deixaria
 *     sessões antigas apontando para o vazio. O snapshot na sessão já protege o
 *     valor, mas a conciliação precisa saber qual tarifa foi aplicada.
 *  2. **Editar não muda o passado.** Uma sessão carrega a cópia congelada das
 *     condições. Alterar o preço hoje muda as recargas de amanhã, nunca as de
 *     ontem — provado por teste, não por promessa.
 */

const TARIFF_INCLUDE = {
  site: { select: { id: true, name: true } },
  _count: { select: { sessions: true } },
} satisfies Prisma.TariffInclude;

type TarifaComRelacoes = Prisma.TariffGetPayload<{ include: typeof TARIFF_INCLUDE }>;

export interface TariffView {
  id: string;
  organizationId: string;
  siteId: string | null;
  siteName: string | null;
  name: string;

  pricePerKwhCents: number;
  connectionFeeCents: number;
  pricePerMinuteCents: number;
  idleFeePerMinuteCents: number;
  minimumAmountCents: number;
  maximumAmountCents: number | null;

  active: boolean;
  validFrom: Date;
  validUntil: Date | null;
  /** Verdadeiro quando a tarifa está valendo agora, e não só cadastrada. */
  inEffect: boolean;
  /** Abrangência, em texto: "todo o estabelecimento X" ou "toda a organização". */
  scopeLabel: string;
  sessionCount: number;

  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class TariffsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    user: AuthenticatedUser,
    pagination: PaginationDto,
    filtros: { siteId?: string; includeInactive?: boolean } = {},
  ): Promise<Paginated<TariffView>> {
    const where: Prisma.TariffWhereInput = organizationFilter(user);

    if (filtros.siteId) where.siteId = filtros.siteId;
    if (!filtros.includeInactive) where.status = 'ACTIVE';

    const [registros, total] = await Promise.all([
      this.prisma.tariff.findMany({
        where,
        include: TARIFF_INCLUDE,
        // A específica antes da geral, e a mais recente antes da antiga — a
        // mesma ordem que a resolução usa para escolher. `nulls: 'last'` não é
        // decoração: em DESC o Postgres põe NULL primeiro.
        orderBy: [{ siteId: { sort: 'desc', nulls: 'last' } }, { validFrom: 'desc' }],
        skip: pagination.skip,
        take: pagination.pageSize,
      }),
      this.prisma.tariff.count({ where }),
    ]);

    const agora = new Date();
    return paginated(
      registros.map((t) => this.toView(t, agora)),
      total,
      pagination,
    );
  }

  async get(user: AuthenticatedUser, id: string): Promise<TariffView> {
    const tarifa = await this.buscar(user, id);
    return this.toView(tarifa, new Date());
  }

  async create(user: AuthenticatedUser, dto: CreateTariffDto): Promise<TariffView> {
    // O estabelecimento é lido primeiro porque ele já determina a organização —
    // um administrador global que informe apenas o site não precisa repetir a
    // organização, e informar as duas em desacordo vira erro em vez de tarifa
    // criada no lugar errado.
    let organizacaoDoSite: string | undefined;

    if (dto.siteId) {
      const site = await this.prisma.site.findUnique({
        where: { id: dto.siteId },
        select: { organizationId: true },
      });

      if (!site) {
        throw new BadRequestException({
          code: 'SITE_NOT_FOUND',
          message: 'Estabelecimento não encontrado.',
        });
      }

      assertSameOrganization(user, site.organizationId);
      organizacaoDoSite = site.organizationId;

      if (dto.organizationId && dto.organizationId !== site.organizationId) {
        throw new ConflictException({
          code: 'SITE_ORGANIZATION_MISMATCH',
          message: 'O estabelecimento informado pertence a outra organização.',
        });
      }
    }

    const organizationId = organizationForCreate(user, organizacaoDoSite ?? dto.organizationId);

    const validFrom = dto.validFrom ? new Date(dto.validFrom) : new Date();
    const validUntil = dto.validUntil ? new Date(dto.validUntil) : null;

    this.validarRegras({
      minimumAmountCents: dto.minimumAmountCents ?? 0,
      maximumAmountCents: dto.maximumAmountCents ?? null,
      validFrom,
      validUntil,
      pricePerKwhCents: dto.pricePerKwhCents,
      connectionFeeCents: dto.connectionFeeCents ?? 0,
      pricePerMinuteCents: dto.pricePerMinuteCents ?? 0,
      idleFeePerMinuteCents: dto.idleFeePerMinuteCents ?? 0,
    });

    const criada = await this.prisma.tariff.create({
      data: {
        organizationId,
        siteId: dto.siteId ?? null,
        name: dto.name,
        pricePerKwhCents: dto.pricePerKwhCents,
        connectionFeeCents: dto.connectionFeeCents ?? 0,
        pricePerMinuteCents: dto.pricePerMinuteCents ?? 0,
        idleFeePerMinuteCents: dto.idleFeePerMinuteCents ?? 0,
        minimumAmountCents: dto.minimumAmountCents ?? 0,
        maximumAmountCents: dto.maximumAmountCents ?? null,
        validFrom,
        validUntil,
      },
      include: TARIFF_INCLUDE,
    });

    return this.toView(criada, new Date());
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateTariffDto): Promise<TariffView> {
    const atual = await this.buscar(user, id);

    const proposta = {
      pricePerKwhCents: dto.pricePerKwhCents ?? atual.pricePerKwhCents,
      connectionFeeCents: dto.connectionFeeCents ?? atual.connectionFeeCents,
      pricePerMinuteCents: dto.pricePerMinuteCents ?? atual.pricePerMinuteCents,
      idleFeePerMinuteCents: dto.idleFeePerMinuteCents ?? atual.idleFeePerMinuteCents,
      minimumAmountCents: dto.minimumAmountCents ?? atual.minimumAmountCents,
      maximumAmountCents:
        dto.maximumAmountCents === undefined ? atual.maximumAmountCents : dto.maximumAmountCents,
      validFrom: dto.validFrom ? new Date(dto.validFrom) : atual.validFrom,
      validUntil:
        dto.validUntil === undefined
          ? atual.validUntil
          : dto.validUntil === null
            ? null
            : new Date(dto.validUntil),
    };

    this.validarRegras(proposta);

    const atualizada = await this.prisma.tariff.update({
      where: { id },
      data: {
        name: dto.name,
        ...proposta,
        status: dto.active === undefined ? undefined : dto.active ? 'ACTIVE' : 'INACTIVE',
      },
      include: TARIFF_INCLUDE,
    });

    return this.toView(atualizada, new Date());
  }

  /**
   * Desativa a tarifa.
   *
   * Não existe endpoint de exclusão, e é deliberado: uma tarifa apagada deixaria
   * a conciliação sem como responder "por qual preço aquela recarga foi
   * cobrada?". O valor cobrado está congelado na sessão, mas a origem dele não.
   */
  async deactivate(user: AuthenticatedUser, id: string): Promise<TariffView> {
    await this.buscar(user, id);

    const desativada = await this.prisma.tariff.update({
      where: { id },
      data: { status: 'INACTIVE' },
      include: TARIFF_INCLUDE,
    });

    return this.toView(desativada, new Date());
  }

  /**
   * Simula o valor de uma recarga com esta tarifa.
   *
   * Existe para o operador conferir o preço **antes** de a tarifa valer para um
   * motorista de verdade. Usa exatamente a mesma função do fechamento — se
   * usasse outra, a simulação poderia divergir do que é cobrado, que é
   * precisamente o defeito que ela deveria prevenir.
   */
  async simulate(
    user: AuthenticatedUser,
    id: string,
    dto: SimulateTariffDto,
  ): Promise<PricingBreakdown> {
    const tarifa = await this.buscar(user, id);

    return calculateSessionAmount({
      snapshot: this.toSnapshot(tarifa),
      energyWh: dto.energyWh,
      durationSeconds: dto.durationSeconds,
      idleSeconds: dto.idleSeconds ?? 0,
      ceilingAmountCents: dto.ceilingAmountCents ?? null,
    });
  }

  // ---------------------------------------------------------------------------

  private async buscar(user: AuthenticatedUser, id: string): Promise<TarifaComRelacoes> {
    const tarifa = await this.prisma.tariff.findUnique({ where: { id }, include: TARIFF_INCLUDE });

    if (!tarifa) {
      throw new NotFoundException({ code: 'TARIFF_NOT_FOUND', message: 'Tarifa não encontrada.' });
    }

    assertSameOrganization(user, tarifa.organizationId);
    return tarifa;
  }

  /**
   * Regras que o banco não consegue impor.
   *
   * A primeira já era verificada no cálculo (`@bora/pricing`), mas lá é tarde:
   * a tarifa contraditória já teria sido salva e só quebraria no fechamento de
   * uma recarga real, com o motorista esperando.
   */
  private validarRegras(t: {
    minimumAmountCents: number;
    maximumAmountCents: number | null;
    validFrom: Date;
    validUntil: Date | null;
    pricePerKwhCents: number;
    connectionFeeCents: number;
    pricePerMinuteCents: number;
    idleFeePerMinuteCents: number;
  }): void {
    if (t.maximumAmountCents !== null && t.maximumAmountCents < t.minimumAmountCents) {
      throw new ConflictException({
        code: 'TARIFF_MAX_BELOW_MIN',
        message:
          'O valor máximo não pode ser menor que o mínimo — nenhuma recarga conseguiria ' +
          'atingir o mínimo configurado.',
      });
    }

    if (t.validUntil && t.validUntil <= t.validFrom) {
      throw new ConflictException({
        code: 'TARIFF_INVALID_PERIOD',
        message: 'O fim da validade precisa ser posterior ao início.',
      });
    }

    // Tarifa inteiramente zerada é quase certamente engano de preenchimento —
    // e o efeito é recarga de graça, que ninguém quer descobrir no fim do mês.
    const tudoZero =
      t.pricePerKwhCents === 0 &&
      t.connectionFeeCents === 0 &&
      t.pricePerMinuteCents === 0 &&
      t.idleFeePerMinuteCents === 0;

    if (tudoZero) {
      throw new ConflictException({
        code: 'TARIFF_ALL_ZERO',
        message:
          'A tarifa não cobra nada: preço por kWh, taxa de conexão, preço por minuto e ' +
          'ociosidade estão todos zerados. Toda recarga sairia de graça.',
      });
    }
  }

  private toSnapshot(t: TarifaComRelacoes): TariffSnapshot {
    return {
      tariffId: t.id,
      name: t.name,
      pricePerKwhCents: t.pricePerKwhCents,
      connectionFeeCents: t.connectionFeeCents,
      pricePerMinuteCents: t.pricePerMinuteCents,
      minimumAmountCents: t.minimumAmountCents,
      maximumAmountCents: t.maximumAmountCents,
      idleFeePerMinuteCents: t.idleFeePerMinuteCents,
      snapshotAt: new Date().toISOString(),
    };
  }

  private toView(t: TarifaComRelacoes, agora: Date): TariffView {
    const ativa = t.status === 'ACTIVE';
    const dentroDoPrazo = t.validFrom <= agora && (t.validUntil === null || t.validUntil >= agora);

    return {
      id: t.id,
      organizationId: t.organizationId,
      siteId: t.siteId,
      siteName: t.site?.name ?? null,
      name: t.name,

      pricePerKwhCents: t.pricePerKwhCents,
      connectionFeeCents: t.connectionFeeCents,
      pricePerMinuteCents: t.pricePerMinuteCents,
      idleFeePerMinuteCents: t.idleFeePerMinuteCents,
      minimumAmountCents: t.minimumAmountCents,
      maximumAmountCents: t.maximumAmountCents,

      active: ativa,
      validFrom: t.validFrom,
      validUntil: t.validUntil,
      // Ativa e cadastrada não é o mesmo que valendo: uma tarifa com início no
      // mês que vem aparece ativa e não é aplicada a nenhuma recarga hoje.
      inEffect: ativa && dentroDoPrazo,
      scopeLabel: t.site ? `Estabelecimento ${t.site.name}` : 'Toda a organização',
      sessionCount: t._count.sessions,

      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };
  }
}
