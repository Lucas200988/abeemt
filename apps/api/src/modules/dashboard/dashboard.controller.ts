import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { DashboardService, type DashboardOverview } from './dashboard.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

@ApiTags('Visão geral')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Indicadores do painel' })
  @ApiQuery({
    name: 'timezone',
    required: false,
    description: 'Fuso para o recorte "hoje". Padrão: America/Cuiaba.',
  })
  overview(
    @CurrentUser() user: AuthenticatedUser,
    @Query('timezone') timezone?: string,
  ): Promise<DashboardOverview> {
    return this.dashboard.overview(user, timezone);
  }
}
