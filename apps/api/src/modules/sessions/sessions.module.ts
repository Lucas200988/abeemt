import { Module } from '@nestjs/common';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { OcppModule } from '../ocpp/ocpp.module';
import { PricingModule } from '../pricing/pricing.module';

@Module({
  imports: [OcppModule, PricingModule],
  controllers: [SessionsController],
  providers: [SessionsService],
  exports: [SessionsService],
})
export class SessionsModule {}
