import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentWebhooksController } from './payment-webhooks.controller';
import { PaymentsService } from './payments.service';
import { PaymentWebhooksService } from './payment-webhooks.service';
import { PaymentProviderRegistry } from './payment-provider.registry';
import { SessionWorker } from './session-worker.service';
import { PricingModule } from '../pricing/pricing.module';
import { OcppModule } from '../ocpp/ocpp.module';

@Module({
  imports: [PricingModule, OcppModule],
  controllers: [PaymentsController, PaymentWebhooksController],
  providers: [PaymentProviderRegistry, PaymentsService, PaymentWebhooksService, SessionWorker],
  exports: [PaymentsService, PaymentProviderRegistry, SessionWorker],
})
export class PaymentsModule {}
