import { Module } from '@nestjs/common';
import { ChargersController } from './chargers.controller';
import { ChargersService } from './chargers.service';
import { OcppModule } from '../ocpp/ocpp.module';

@Module({
  imports: [OcppModule],
  controllers: [ChargersController],
  providers: [ChargersService],
  exports: [ChargersService],
})
export class ChargersModule {}
