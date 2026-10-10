import { Module } from '@nestjs/common';
import { TerminalsController } from './terminals.controller';
import { TerminalApiController, TerminalPairingController } from './terminal-api.controller';
import { TerminalsService } from './terminals.service';
import { TerminalSessionService } from './terminal-session.service';
import { TerminalGuard } from './terminal.guard';
import { PaymentsModule } from '../payments/payments.module';
import { PricingModule } from '../pricing/pricing.module';
import { OcppModule } from '../ocpp/ocpp.module';

@Module({
  imports: [PaymentsModule, PricingModule, OcppModule],
  controllers: [TerminalsController, TerminalPairingController, TerminalApiController],
  providers: [TerminalsService, TerminalSessionService, TerminalGuard],
  exports: [TerminalsService],
})
export class TerminalsModule {}
