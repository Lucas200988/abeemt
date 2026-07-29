import { Module } from '@nestjs/common';
import { ConnectionRegistry } from './connection-registry';
import { CallDispatcher } from './call-dispatcher';
import { OcppMessageLog } from './ocpp-message-log.service';
import { OcppHandlers } from './ocpp-handlers.service';
import { OcppCommands } from './ocpp-commands.service';
import { OcppGateway } from './ocpp.gateway';

@Module({
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
