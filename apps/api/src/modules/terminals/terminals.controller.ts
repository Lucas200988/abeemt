import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { TerminalsService } from './terminals.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireRole } from '../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CreateTerminalDto, ListTerminalsQueryDto, UpdateTerminalDto } from './dto/terminal.dto';

/** Cadastro das maquininhas, pelo painel. */
@ApiTags('Maquininhas (painel)')
@ApiBearerAuth()
@Controller('terminals')
export class TerminalsController {
  constructor(private readonly terminals: TerminalsService) {}

  private ctx(request: Request) {
    return { ipAddress: request.ip, userAgent: request.get('user-agent') };
  }

  @Get()
  @ApiOperation({ summary: 'Lista as maquininhas cadastradas' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListTerminalsQueryDto) {
    return this.terminals.list(user, query, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe da maquininha' })
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.terminals.get(user, id);
  }

  /**
   * Cadastrar e parear é ato de administrador do estabelecimento, não de
   * operador: quem cria um terminal está emitindo uma credencial que inicia
   * recargas e movimenta cartão.
   */
  @RequireRole('ORG_ADMIN')
  @Post()
  @ApiOperation({
    summary: 'Cadastra uma maquininha e gera o primeiro código de pareamento',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTerminalDto,
    @Req() request: Request,
  ) {
    return this.terminals.create(user, dto, this.ctx(request));
  }

  @RequireRole('ORG_ADMIN')
  @Patch(':id')
  @ApiOperation({ summary: 'Altera o cadastro da maquininha' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTerminalDto,
    @Req() request: Request,
  ) {
    return this.terminals.update(user, id, dto, this.ctx(request));
  }

  @RequireRole('ORG_ADMIN')
  @Post(':id/pairing-code')
  @ApiOperation({
    summary: 'Gera um código de pareamento novo',
    description:
      'Invalida o token atual: o motivo mais comum para gerar código novo é o ' +
      'equipamento ter sido trocado ou perdido.',
  })
  pairingCode(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ) {
    return this.terminals.generatePairingCode(user, id, this.ctx(request));
  }

  @RequireRole('ORG_ADMIN')
  @Post(':id/revoke')
  @ApiOperation({
    summary: 'Corta o acesso da maquininha imediatamente',
    description: 'Para o caso de o equipamento sumir. O cadastro é mantido, para a auditoria.',
  })
  revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ) {
    return this.terminals.revoke(user, id, this.ctx(request));
  }
}
