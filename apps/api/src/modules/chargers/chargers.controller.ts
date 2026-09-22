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
import { ChargersService } from './chargers.service';
import {
  CreateChargerDto,
  CreateConnectorDto,
  ListChargersQueryDto,
  ListMessagesQueryDto,
  SetOperationalStatusDto,
  UpdateChargerDto,
  UpdateConnectorDto,
} from './dto/charger.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireRole } from '../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

@ApiTags('Carregadores')
@ApiBearerAuth()
@Controller('chargers')
export class ChargersController {
  constructor(private readonly chargers: ChargersService) {}

  private ctx(request: Request) {
    return { ipAddress: request.ip, userAgent: request.get('user-agent') };
  }

  @Get()
  @ApiOperation({ summary: 'Lista carregadores com estado atual' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListChargersQueryDto) {
    return this.chargers.list(user, query, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe do carregador, com conectores' })
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.chargers.get(user, id);
  }

  @Get(':id/messages')
  @ApiOperation({
    summary: 'Mensagens OCPP do carregador (área de diagnóstico)',
    description: 'Payloads crus, para investigação técnica.',
  })
  messages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListMessagesQueryDto,
  ) {
    return this.chargers.messages(user, id, query, query);
  }

  @RequireRole('ORG_ADMIN')
  @Post()
  @ApiOperation({
    summary: 'Cadastra um carregador',
    description: 'Com generateCredential=true, a credencial é devolvida uma única vez.',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateChargerDto,
    @Req() request: Request,
  ) {
    return this.chargers.create(user, dto, this.ctx(request));
  }

  @RequireRole('ORG_ADMIN')
  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza um carregador' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateChargerDto,
    @Req() request: Request,
  ) {
    return this.chargers.update(user, id, dto, this.ctx(request));
  }

  // Bloquear e liberar é operação, não administração: o operador precisa poder.
  @RequireRole('OPERATOR')
  @Patch(':id/operational-status')
  @ApiOperation({
    summary: 'Bloqueia, libera ou marca manutenção',
    description: 'Não interrompe recarga em andamento — só impede novas.',
  })
  setStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetOperationalStatusDto,
    @Req() request: Request,
  ) {
    return this.chargers.setOperationalStatus(user, id, dto.status, {
      ...this.ctx(request),
      reason: dto.reason,
    });
  }

  @RequireRole('ORG_ADMIN')
  @Post(':id/credential')
  @ApiOperation({
    summary: 'Gera uma credencial nova, invalidando a anterior',
    description: 'A credencial é devolvida uma única vez; guardamos apenas o hash.',
  })
  rotateCredential(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ) {
    return this.chargers.rotateCredential(user, id, this.ctx(request));
  }

  @RequireRole('ORG_ADMIN')
  @Post(':id/connectors')
  @ApiOperation({ summary: 'Cadastra um conector' })
  addConnector(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateConnectorDto,
    @Req() request: Request,
  ) {
    return this.chargers.addConnector(user, id, dto, this.ctx(request));
  }

  @RequireRole('ORG_ADMIN')
  @Patch(':id/connectors/:connectorId')
  @ApiOperation({ summary: 'Atualiza um conector' })
  updateConnector(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('connectorId', ParseUUIDPipe) connectorId: string,
    @Body() dto: UpdateConnectorDto,
    @Req() request: Request,
  ) {
    return this.chargers.updateConnector(user, id, connectorId, dto, this.ctx(request));
  }
}
