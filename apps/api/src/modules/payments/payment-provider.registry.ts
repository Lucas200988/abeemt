import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  ManualPaymentProvider,
  MockPaymentProvider,
  PagBankProvider,
  RedeProvider,
  TerminalMockPaymentProvider,
  assertProviderSupportsModel,
  pendenciasDoContrato,
  pendenciasDoContratoRede,
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
    this.register(new TerminalMockPaymentProvider(runtimeEnv.BORA_TERMINAL_MOCK_CAPTURE_LOCATION));

    /**
     * O adquirente real só é registrado quando há credencial configurada.
     *
     * Registrar sempre significaria oferecer no painel um provedor que falharia
     * na primeira chamada. Sem credencial, ele simplesmente não existe.
     */
    if (runtimeEnv.BORA_PAGBANK_BASE_URL && runtimeEnv.BORA_PAGBANK_TOKEN) {
      this.register(
        new PagBankProvider({
          baseUrl: runtimeEnv.BORA_PAGBANK_BASE_URL,
          token: runtimeEnv.BORA_PAGBANK_TOKEN,
          webhookSecret: runtimeEnv.BORA_PAGBANK_WEBHOOK_SECRET,
          verificado: runtimeEnv.BORA_PAGBANK_VERIFIED,
        }),
      );
    }

    /**
     * Rede (e.Rede). Sem PV e chave, nem entra na lista — mesma regra do
     * PagBank: um provedor que falharia na primeira chamada não é oferecido.
     */
    if (runtimeEnv.BORA_REDE_PV && runtimeEnv.BORA_REDE_INTEGRATION_KEY) {
      this.register(
        new RedeProvider({
          pv: runtimeEnv.BORA_REDE_PV,
          integrationKey: runtimeEnv.BORA_REDE_INTEGRATION_KEY,
          baseUrl: runtimeEnv.BORA_REDE_BASE_URL,
          oauthUrl: runtimeEnv.BORA_REDE_OAUTH_URL,
          webhookToken: runtimeEnv.BORA_REDE_WEBHOOK_TOKEN,
          verificado: runtimeEnv.BORA_REDE_VERIFIED,
        }),
      );
    }
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

    if (runtimeEnv.NODE_ENV === 'production' && this.simulado(padrao)) {
      throw new Error(
        `BORA_PAYMENT_PROVIDER="${padrao}" é um provedor simulado e não pode ser o padrão em ` +
          'produção: toda recarga seria aprovada sem cobrança. Configure o adquirente real.',
      );
    }

    /**
     * Adapter de adquirente não verificado nunca pode ser o padrão.
     *
     * Ele recusaria toda operação, e o sintoma seria motorista sem conseguir
     * pagar. Falhar no boot deixa claro que falta confirmar o contrato — e não
     * é um detalhe: é a diferença entre "escrito" e "funciona".
     */
    if (padrao === 'pagbank' && !runtimeEnv.BORA_PAGBANK_VERIFIED) {
      throw new Error(
        'O adapter do PagBank ainda não foi verificado contra o sandbox e não pode ser o ' +
          `provedor padrão. Itens pendentes no contrato: ${pendenciasDoContrato().join(', ')}.\n` +
          'Ver docs/payments/fase-7-o-que-falta.md.',
      );
    }

    if (padrao === 'rede' && !runtimeEnv.BORA_REDE_VERIFIED) {
      throw new Error(
        'O adapter da Rede ainda não foi verificado contra o sandbox e não pode ser o ' +
          'provedor padrão. O manual foi lido, mas a suíte de conformidade precisa passar ' +
          `com as credenciais reais. Pendências: ${pendenciasDoContratoRede().join(', ') || 'nenhuma'}.\n` +
          'Ver docs/payments/rede-e-rede-contrato.md.',
      );
    }

    this.validarProvedorDeTerminal();

    this.logger.log(
      {
        padrao,
        terminal: runtimeEnv.BORA_TERMINAL_PAYMENT_PROVIDER,
        disponiveis: [...this.providers.keys()],
      },
      'provedores de pagamento validados',
    );
  }

  /**
   * O provedor das maquininhas precisa ser terminal-iniciado.
   *
   * Configurar um provedor `backend` aqui não daria erro no boot sem esta
   * verificação: a maquininha receberia `PROVIDER_IS_BACKEND_INITIATED` na
   * primeira recarga, com um motorista parado na frente do carregador.
   */
  private validarProvedorDeTerminal(): void {
    const nome = runtimeEnv.BORA_TERMINAL_PAYMENT_PROVIDER;
    const provider = this.providers.get(nome);

    if (!provider) {
      throw new Error(
        `BORA_TERMINAL_PAYMENT_PROVIDER="${nome}" não corresponde a nenhum provedor registrado. ` +
          `Disponíveis: ${[...this.providers.keys()].join(', ')}.`,
      );
    }

    if (provider.capabilities.initiatedBy !== 'terminal') {
      throw new Error(
        `BORA_TERMINAL_PAYMENT_PROVIDER="${nome}" autoriza pelo backend, não pelo terminal. ` +
          'As maquininhas não conseguiriam registrar pagamento nenhum.',
      );
    }

    if (runtimeEnv.NODE_ENV === 'production' && this.simulado(nome)) {
      throw new Error(
        `BORA_TERMINAL_PAYMENT_PROVIDER="${nome}" é um provedor simulado e não pode ser usado ` +
          'em produção: toda recarga por maquininha seria aprovada sem cobrança.',
      );
    }
  }

  /** Provedor usado pelas maquininhas. A maquininha nunca escolhe (risco R-32). */
  terminalDefault(): PaymentProvider {
    return this.get(runtimeEnv.BORA_TERMINAL_PAYMENT_PROVIDER);
  }

  /** O painel precisa dizer, na tela, que aquele pagamento não é real. */
  simulado(name: string): boolean {
    return name === 'mock' || name === 'manual' || name === 'terminal-mock';
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
