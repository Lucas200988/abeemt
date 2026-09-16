import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { SessionsService } from './sessions.service';
import { CancelSessionDto, ListSessionsQueryDto, StartManualSessionDto } from './dto/session.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireRole } from '../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

@ApiTags('Sessões')
@ApiBearerAuth()
@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  private ctx(request: Request) {
    return { ipAddress: request.ip, userAgent: request.get('user-agent') };
  }

  @Get()
  @ApiOperation({ summary: 'Lista sessões de recarga' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListSessionsQueryDto) {
    return this.sessions.list(user, query, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe da sessão, com linha do tempo' })
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sessions.get(user, id);
  }

  @Get(':id/meter-values')
  @ApiOperation({
    summary: 'Leituras de energia da sessão',
    description: 'Energia relativa ao início da sessão, em Wh, para acompanhamento ao vivo.',
  })
  meterValues(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sessions.meterValues(user, id);
  }

  @RequireRole('OPERATOR')
  @Post('manual-start')
  @ApiOperation({
    summary: 'Inicia uma recarga manualmente, sem pagamento',
    description: 'Para operação e teste. A sessão fica marcada como sem pagamento.',
  })
  startManual(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: StartManualSessionDto,
    @Req() request: Request,
  ) {
    return this.sessions.startManual(user, dto, this.ctx(request));
  }

  @RequireRole('OPERATOR')
  @Post(':id/stop')
  @ApiOperation({ summary: 'Encerra uma recarga em andamento' })
  stop(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ) {
    return this.sessions.stopManual(user, id, this.ctx(request));
  }

  @RequireRole('OPERATOR')
  @Post(':id/cancel')
  @ApiOperation({
    summary: 'Cancela uma sessão que ainda não começou',
    description: 'Recarga já iniciada precisa ser parada, não cancelada.',
  })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelSessionDto,
    @Req() request: Request,
  ) {
    return this.sessions.cancel(user, id, dto.reason, this.ctx(request));
  }
}
