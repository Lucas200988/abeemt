import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { OcppModule } from '../ocpp/ocpp.module';
import { HealthController, PrismaHealthIndicator } from './health.controller';

@Module({
  imports: [TerminusModule, OcppModule],
  controllers: [HealthController],
  providers: [PrismaHealthIndicator],
})
export class HealthModule {}
