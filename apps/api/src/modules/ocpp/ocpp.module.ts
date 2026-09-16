import { Module } from '@nestjs/common';
import { PricingModule } from '../pricing/pricing.module';
import { ConnectionRegistry } from './connection-registry';
import { CallDispatcher } from './call-dispatcher';
import { OcppMessageLog } from './ocpp-message-log.service';
import { OcppHandlers } from './ocpp-handlers.service';
import { OcppCommands } from './ocpp-commands.service';
import { OcppGateway } from './ocpp.gateway';

@Module({
  // O handler de MeterValues precisa do cálculo para a parada automática
  // (ADR-0008 §4). É a única dependência do módulo OCPP fora dele.
  imports: [PricingModule],
  providers: [
    ConnectionRegistry,
    CallDispatcher,
    OcppMessageLog,
    OcppHandlers,
    OcppCommands,
    OcppGateway,
  ],
  exports: [OcppGateway, OcppCommands, ConnectionRegistry, CallDispatcher],
})
export class OcppModule {}
