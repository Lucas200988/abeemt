import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AlertsService } from './alerts.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

@ApiTags('Alertas')
@ApiBearerAuth()
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get()
  @ApiOperation({
    summary: 'Alertas operacionais, recalculados agora',
    description:
      'Cada item aponta um problema que custa dinheiro ou reputação se ficar ' +
      'invisível, com o runbook correspondente em docs/operations/incident-response.md.',
  })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.alerts.evaluate(user);
  }
}
