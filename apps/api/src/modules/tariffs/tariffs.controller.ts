import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { TariffsService } from './tariffs.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateTariffDto,
  ListTariffsQueryDto,
  SimulateTariffDto,
  UpdateTariffDto,
} from './dto/tariff.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireRole } from '../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

/**
 * Tarifas.
 *
 * Leitura para qualquer usuário autenticado — um operador precisa saber o preço
 * que está praticando. Escrita só para `ORG_ADMIN`: mudar preço é decisão
 * comercial, não operação de rotina, e toda alteração vai para a auditoria com
 * o valor anterior e o novo.
 */
@ApiTags('Tarifas')
@ApiBearerAuth()
@Controller('tariffs')
export class TariffsController {
  constructor(
    private readonly tariffs: TariffsService,
    private readonly audit: AuditService,
  ) {}

  private ctx(request: Request) {
    return { ipAddress: request.ip, userAgent: request.get('user-agent') };
  }

  @Get()
  @ApiOperation({ summary: 'Lista tarifas' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListTariffsQueryDto) {
    return this.tariffs.list(user, query, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe da tarifa' })
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.tariffs.get(user, id);
  }

  @Post(':id/simulate')
  @ApiOperation({
    summary: 'Simula o valor de uma recarga com esta tarifa',
    description:
      'Usa exatamente a mesma função do fechamento real, para que a simulação não possa ' +
      'divergir do que é cobrado.',
  })
  simulate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SimulateTariffDto,
  ) {
    return this.tariffs.simulate(user, id, dto);
  }

  @RequireRole('ORG_ADMIN')
  @Post()
  @ApiOperation({ summary: 'Cria uma tarifa' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTariffDto,
    @Req() request: Request,
  ) {
    const criada = await this.tariffs.create(user, dto);

    await this.audit.record({
      user,
      action: 'tariff.create',
      entityType: 'Tariff',
      entityId: criada.id,
      organizationId: criada.organizationId,
      newValue: criada,
      ...this.ctx(request),
    });

    return criada;
  }

  @RequireRole('ORG_ADMIN')
  @Patch(':id')
  @ApiOperation({
    summary: 'Altera uma tarifa',
    description:
      'Não afeta recargas já realizadas: cada sessão guarda uma cópia congelada das ' +
      'condições que valiam quando aconteceu.',
  })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTariffDto,
    @Req() request: Request,
  ) {
    // Lido antes para que a auditoria registre o preço anterior — sem isso,
    // "quem mudou o preço e de quanto para quanto?" fica sem resposta.
    const antes = await this.tariffs.get(user, id);
    const depois = await this.tariffs.update(user, id, dto);

    await this.audit.record({
      user,
      action: 'tariff.update',
      entityType: 'Tariff',
      entityId: id,
      organizationId: depois.organizationId,
      previousValue: antes,
      newValue: depois,
      ...this.ctx(request),
    });

    return depois;
  }

  @RequireRole('ORG_ADMIN')
  @Post(':id/deactivate')
  @ApiOperation({
    summary: 'Desativa uma tarifa',
    description: 'Tarifa não é apagada: o histórico financeiro precisa continuar explicável.',
  })
  async deactivate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ) {
    const desativada = await this.tariffs.deactivate(user, id);

    await this.audit.record({
      user,
      action: 'tariff.deactivate',
      entityType: 'Tariff',
      entityId: id,
      organizationId: desativada.organizationId,
      newValue: { active: false },
      ...this.ctx(request),
    });

    return desativada;
  }
}
