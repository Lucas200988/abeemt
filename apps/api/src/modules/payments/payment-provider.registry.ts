import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  ManualPaymentProvider,
  MockPaymentProvider,
  assertProviderSupportsModel,
  type PaymentProvider,
} from '@bora/payment-core';
import { runtimeEnv } from '../../config/runtime-env';

/**
 * Provedores de pagamento disponíveis.
 *
 * Mais de um coexiste de propósito: o `manual` continua valendo mesmo depois de
 * um adquirente real entrar, porque atendimento excepcional e o teste com o
 * equipamento (FASE 4) precisam de uma aprovação que não passa por adquirente.
 *
 * Registrar um adquirente novo (FASE 7) é acrescentar uma linha no construtor.
 * Nada fora daqui conhece o nome do fornecedor — é o ponto do ADR-0004.
 */
@Injectable()
export class PaymentProviderRegistry implements OnModuleInit {
  private readonly logger = new Logger(PaymentProviderRegistry.name);
  private readonly providers = new Map<string, PaymentProvider>();

  constructor() {
    this.register(new MockPaymentProvider());
    this.register(new ManualPaymentProvider());
  }

  /**
   * Verificações que precisam falhar no boot, não no primeiro pagamento.
   *
   * A segunda é a mais importante: sem ela, subir em produção esquecendo
   * `BORA_PAYMENT_PROVIDER` daria recarga de graça para todo mundo, com o
   * sistema reportando "pagamento aprovado" em cada uma.
   */
  onModuleInit(): void {
    for (const provider of this.providers.values()) {
      assertProviderSupportsModel(provider, { requirePix: true });
    }

    const padrao = runtimeEnv.BORA_PAYMENT_PROVIDER;

    if (!this.providers.has(padrao)) {
      throw new Error(
        `BORA_PAYMENT_PROVIDER="${padrao}" não corresponde a nenhum provedor registrado. ` +
          `Disponíveis: ${[...this.providers.keys()].join(', ')}.`,
      );
    }

    if (runtimeEnv.NODE_ENV === 'production' && (padrao === 'mock' || padrao === 'manual')) {
      throw new Error(
        `BORA_PAYMENT_PROVIDER="${padrao}" é um provedor simulado e não pode ser o padrão em ` +
          'produção: toda recarga seria aprovada sem cobrança. Configure o adquirente real.',
      );
    }

    this.logger.log(
      { padrao, disponiveis: [...this.providers.keys()] },
      'provedores de pagamento validados',
    );
  }

  register(provider: PaymentProvider): void {
    this.providers.set(provider.name, provider);
  }

  /** Provedor pelo nome gravado no pagamento. */
  get(name: string): PaymentProvider {
    const provider = this.providers.get(name);

    if (!provider) {
      // Acontece se um pagamento antigo aponta para um provedor que saiu do
      // código. Falhar alto é melhor do que capturar pelo provedor errado.
      throw new Error(`provedor de pagamento desconhecido: "${name}"`);
    }

    return provider;
  }

  /** Provedor usado para novos pagamentos. */
  default(): PaymentProvider {
    return this.get(runtimeEnv.BORA_PAYMENT_PROVIDER);
  }

  names(): string[] {
    return [...this.providers.keys()];
  }
}
