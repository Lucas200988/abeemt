import { Module } from '@nestjs/common';
import { SessionPricingService } from './session-pricing.service';

/**
 * Módulo sem controller: cálculo de valor não é endpoint.
 *
 * Fica isolado porque três lugares precisam dele — o pagamento (ao reservar), o
 * handler de MeterValues (parada automática) e o fechamento da sessão — e
 * nenhum deles deveria depender dos outros dois.
 */
@Module({
  providers: [SessionPricingService],
  exports: [SessionPricingService],
})
export class PricingModule {}
