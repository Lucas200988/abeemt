import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { OcppModule } from '../ocpp/ocpp.module';

@Module({
  imports: [OcppModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
