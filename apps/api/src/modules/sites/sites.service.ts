import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  assertSameOrganization,
  organizationFilter,
  organizationForCreate,
} from '../../common/tenant-scope';
import { paginated, type Paginated, type PaginationDto } from '../../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import type { CreateSiteDto, UpdateSiteDto } from './dto/site.dto';

/** Estabelecimento como o painel precisa ver. */
export interface SiteView {
  id: string;
  organizationId: string;
  organizationName: string;
  name: string;
  legalName: string | null;
  taxId: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  timezone: string;
  status: string;
  preAuthCeilingCents: number | null;
  chargerCount: number;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class SitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthenticatedUser, pagination: PaginationDto): Promise<Paginated<SiteView>> {
    // O escopo vem do serviço, não do controller (ver tenant-scope.ts).
    const where = organizationFilter(user);

    const [registros, total] = await Promise.all([
      this.prisma.site.findMany({
        where,
        include: {
          organization: { select: { name: true } },
          _count: { select: { chargers: true } },
        },
        orderBy: { name: 'asc' },
        skip: pagination.skip,
        take: pagination.pageSize,
      }),
      this.prisma.site.count({ where }),
    ]);

    return paginated(
      registros.map((s) => this.toView(s)),
      total,
      pagination,
    );
  }

  async get(user: AuthenticatedUser, id: string): Promise<SiteView> {
    const site = await this.prisma.site.findUnique({
      where: { id },
      include: {
        organization: { select: { name: true } },
        _count: { select: { chargers: true } },
      },
    });

    if (!site) {
      throw new NotFoundException({
        code: 'SITE_NOT_FOUND',
        message: 'Estabelecimento não encontrado.',
      });
    }

    assertSameOrganization(user, site.organizationId);

    return this.toView(site);
  }

  async create(
    user: AuthenticatedUser,
    dto: CreateSiteDto,
    context: { ipAddress?: string; userAgent?: string },
  ): Promise<SiteView> {
    const organizationId = organizationForCreate(user, dto.organizationId);

    const criado = await this.prisma.site.create({
      data: {
        organizationId,
        name: dto.name,
        legalName: dto.legalName,
        taxId: dto.taxId,
        address: dto.address,
        city: dto.city,
        state: dto.state,
        postalCode: dto.postalCode,
        timezone: dto.timezone ?? 'America/Cuiaba',
        preAuthCeilingCents: dto.preAuthCeilingCents,
      },
      include: {
        organization: { select: { name: true } },
        _count: { select: { chargers: true } },
      },
    });

    await this.audit.record({
      user,
      action: 'site.create',
      entityType: 'Site',
      entityId: criado.id,
      organizationId,
      newValue: { name: criado.name, city: criado.city },
      ...context,
    });

    return this.toView(criado);
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateSiteDto,
    context: { ipAddress?: string; userAgent?: string },
  ): Promise<SiteView> {
    const anterior = await this.prisma.site.findUnique({ where: { id } });

    if (!anterior) {
      throw new NotFoundException({
        code: 'SITE_NOT_FOUND',
        message: 'Estabelecimento não encontrado.',
      });
    }

    assertSameOrganization(user, anterior.organizationId);

    const atualizado = await this.prisma.site.update({
      where: { id },
      data: {
        name: dto.name,
        legalName: dto.legalName,
        taxId: dto.taxId,
        address: dto.address,
        city: dto.city,
        state: dto.state,
        postalCode: dto.postalCode,
        timezone: dto.timezone,
        status: dto.status,
        preAuthCeilingCents: dto.preAuthCeilingCents,
      },
      include: {
        organization: { select: { name: true } },
        _count: { select: { chargers: true } },
      },
    });

    await this.audit.record({
      user,
      action: 'site.update',
      entityType: 'Site',
      entityId: id,
      organizationId: anterior.organizationId,
      previousValue: {
        name: anterior.name,
        status: anterior.status,
        preAuthCeilingCents: anterior.preAuthCeilingCents,
      },
      newValue: {
        name: atualizado.name,
        status: atualizado.status,
        preAuthCeilingCents: atualizado.preAuthCeilingCents,
      },
      ...context,
    });

    return this.toView(atualizado);
  }

  private toView(site: {
    id: string;
    organizationId: string;
    organization: { name: string };
    name: string;
    legalName: string | null;
    taxId: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    timezone: string;
    status: string;
    preAuthCeilingCents: number | null;
    _count: { chargers: number };
    createdAt: Date;
    updatedAt: Date;
  }): SiteView {
    return {
      id: site.id,
      organizationId: site.organizationId,
      organizationName: site.organization.name,
      name: site.name,
      legalName: site.legalName,
      taxId: site.taxId,
      address: site.address,
      city: site.city,
      state: site.state,
      postalCode: site.postalCode,
      timezone: site.timezone,
      status: site.status,
      preAuthCeilingCents: site.preAuthCeilingCents,
      chargerCount: site._count.chargers,
      createdAt: site.createdAt,
      updatedAt: site.updatedAt,
    };
  }
}
