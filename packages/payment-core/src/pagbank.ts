import { createHash, timingSafeEqual } from 'node:crypto';
import { assertCents, type Cents } from '@bora/contracts';
import { HttpPaymentProvider, type HttpProviderConfig } from './http-provider';
import {
  PaymentProviderError,
  type AuthorizeInput,
  type PaymentCapabilities,
  type PaymentProvider,
  type PaymentResult,
  type PaymentStatus,
  type PaymentWebhookEvent,
} from './provider';

/**
 * Adapter do PagBank.
 *
 * ⚠️ **NÃO VERIFICADO CONTRA A API REAL.**
 *
 * O portal de documentação do PagBank recusa acesso automatizado (HTTP 403,
 * confirmado em 2026-07-31 em `developer.pagbank.com.br` e `docs.pagar.me`).
 * Sem poder ler o contrato, escrever caminhos e nomes de campos por suposição
 * produziria código que **parece** pronto e não é — e pagamento é o pior lugar
 * possível para isso.
 *
 * A saída foi separar o que se sabe do que se supõe:
 *
 *  * tudo que **não** depende do fornecedor está em `HttpPaymentProvider`, e é
 *    testado de verdade — prazo, retentativa, idempotência, assinatura HMAC,
 *    redação de credencial;
 *  * tudo que depende está em `CONTRATO`, abaixo, com a procedência de cada
 *    item marcada. Confirmar o adapter é conferir essa tabela contra a
 *    documentação e rodar a suíte de conformidade contra o sandbox.
 *
 * Enquanto `BORA_PAGBANK_VERIFIED` não for `true`, o registro de provedores
 * recusa este adapter. Um adapter de pagamento não verificado no ar é como se
 * perde dinheiro sem perceber.
 *
 * Ver `docs/payments/fase-7-o-que-falta.md`.
 */

/** Procedência de cada item do contrato. Honestidade explícita, não decorativa. */
type Procedencia = 'confirmado' | 'a confirmar';

interface ItemContrato<T> {
  valor: T;
  procedencia: Procedencia;
  nota?: string;
}

const item = <T>(valor: T, procedencia: Procedencia, nota?: string): ItemContrato<T> => ({
  valor,
  procedencia,
  nota,
});

/**
 * Cartões FICTÍCIOS do sandbox do PagBank.
 *
 * Lidos em `portaldev.pagbank.com.br/cartoes-teste` em 2026-08-03, trazidos por
 * Lucas. Não são cartões de ninguém: são números reservados para teste, e o
 * próprio portal os publica em tela aberta.
 *
 * Ficam aqui pelo mesmo motivo que a tabela equivalente da Rede ficou: sem ela
 * não dá para forçar aprovação e recusa de propósito, e um adapter de pagamento
 * que só foi exercitado no caminho feliz não foi exercitado.
 *
 * ⚠️ Estes números **não funcionam em produção** e não devem ser usados lá.
 */
export const CARTOES_DE_TESTE_SANDBOX = {
  aprovados: [
    { numero: '4539620659922097', bandeira: 'visa' },
    { numero: '5240082975622454', bandeira: 'mastercard' },
    { numero: '345817690311361', bandeira: 'amex' },
    { numero: '4514161122113757', bandeira: 'elo' },
    { numero: '6062828598919021', bandeira: 'hiper' },
  ],
  cvv: '123',
  expiracao: '12/2030',
  /**
   * Cartões que o sandbox SEMPRE recusa — lidos na aba "Negada" em 2026-08-03.
   *
   * São o que permite provar que a recusa é tratada. Na verificação da Rede
   * foi exatamente esse passo que achou um erro real.
   */
  recusados: [
    { numero: '4929291898380766', bandeira: 'visa' },
    { numero: '5530062640663264', bandeira: 'mastercard' },
    { numero: '372938001199778', bandeira: 'amex' },
    { numero: '4389350446134811', bandeira: 'elo' },
    { numero: '6062822916014409', bandeira: 'hiper' },
  ],
} as const;

/**
 * O contrato do fornecedor, em um só lugar.
 *
 * Cada campo aqui é uma pergunta a ser respondida com a documentação aberta. É
 * o único arquivo que precisa mudar quando as credenciais chegarem.
 */
export const CONTRATO = {
  baseUrlSandbox: item(
    'https://sandbox.api.pagseguro.com',
    'confirmado',
    'lido no portal oficial (Ambientes disponíveis) em 2026-08-01, trazido por Lucas',
  ),
  baseUrlProducao: item(
    'https://api.pagseguro.com',
    'confirmado',
    'idem; Transferências/Pix Bacen usam secure.api.pagseguro.com — fora do nosso escopo atual',
  ),

  /**
   * Como a credencial viaja.
   *
   * O portal mostra o cabeçalho em todas as definições OpenAPI publicadas
   * (`Authorization: Bearer <token>`), então este item não é suposição.
   */
  cabecalhoAutorizacao: item(
    'Authorization: Bearer <token>',
    'confirmado',
    'lido nas definições OpenAPI do portal em 2026-08-03, trazidas por Lucas',
  ),

  /**
   * Chave pública de cartão — o que mantém o número fora do nosso servidor.
   *
   * O PagBank criptografa o cartão no cliente com esta chave; o que chega ao
   * backend é um blob cifrado, não o PAN. É o equivalente ao `cardToken` da
   * Rede e é o que sustenta a seção 12 do briefing no caminho online.
   *
   * Também é o que habilita 3DS, exigido para débito.
   */
  criarChavePublica: item(
    '/public-keys',
    'confirmado',
    'POST com { "type": "card" } → 201 { public_key, created_at }. O portal de ' +
      'sandbox tem um gerador que produz o cartão criptografado a partir dessa ' +
      'chave — é assim que se obtém o `metadata.encryptedCard` para testar.',
  ),
  consultarChavePublica: item('/public-keys/card', 'confirmado', 'GET'),
  alterarChavePublica: item(
    '/public-keys/card',
    'confirmado',
    'PUT; a chave antiga continua válida por 7 dias após a troca',
  ),

  /** Criação do pedido com pré-autorização. */
  criarPedido: item(
    '/orders',
    'confirmado',
    'os links SELF/PAY do exemplo oficial de webhook apontam para ' +
      'sandbox.api.pagseguro.com/orders/{id} (lido em 2026-08-03)',
  ),
  /**
   * Captura de uma cobrança pré-autorizada — com PARCIAL documentado.
   *
   * A página "Capturar pagamento" traz o exemplo oficial: reservou 1000,
   * capturou 500, resposta PAID com summary.paid=500 e amount.value=1000. É o
   * critério E2 — "pague só o que consumiu" — confirmado em documento.
   */
  capturar: item(
    '/charges/{chargeId}/capture',
    'confirmado',
    'POST com { amount: { value } }; captura parcial no exemplo oficial',
  ),
  /** Cancelamento da pré-autorização não capturada. */
  cancelar: item(
    '/charges/{chargeId}/cancel',
    'confirmado',
    'link CHARGE.CANCEL (POST) no exemplo oficial de webhook',
  ),
  /**
   * Devolução de valor já capturado — MESMO caminho do cancelamento.
   *
   * A página "Cancelar pagamento" confirma: um só endpoint desfaz
   * pré-autorização E reembolsa captura, com `{ amount: { value } }` parcial ou
   * total. Detalhe que importa: devolução PARCIAL deixa a cobrança `PAID`
   * (summary.refunded > 0); devolução TOTAL deixa `CANCELED` — ver
   * `mapearEstado`.
   */
  devolver: item(
    '/charges/{chargeId}/cancel',
    'confirmado',
    'POST com { amount: { value } }; parcial e total nos exemplos oficiais',
  ),
  consultar: item(
    '/charges/{chargeId}',
    'confirmado',
    'link SELF (GET) no exemplo oficial de webhook',
  ),

  /**
   * O gateway RECUSA `Accept: application/json` — quinta descoberta da
   * verificação (2026-08-03). As consultas respondiam 406; o diagnóstico
   * automático provou: `Accept: application/json` → 406, `Accept: *\/*` → 200,
   * sem Accept → 200. O oposto do que qualquer API JSON faria. Por isso o
   * adapter envia `*\/*` em todas as chamadas (ver `req`).
   */
  cabecalhoAcceptExigido: item('*/*', 'confirmado', 'application/json toma 406 no GET'),

  /**
   * Pré-autorização é `capture: false` na cobrança.
   *
   * Este item veio de material público do PagBank e é o que sustenta o
   * ADR-0008 no fornecedor: reserva de 6 a 29 dias, com `capture_before`
   * definindo o prazo, e captura parcial suportada.
   */
  campoPreAutorizacao: item('capture', 'confirmado', 'false = pré-autoriza; true = cobra direto'),
  campoPrazoCaptura: item(
    'capture_before',
    'confirmado',
    'Visa/Mastercard/Elo: até 29 dias para MCCs permitidos; demais bandeiras: 6 dias',
  ),

  /**
   * Pré-autorização SÓ existe no crédito.
   *
   * O Objeto Charge diz, literalmente: "Função indisponível para o método de
   * pagamento Cartão de Débito e Token de Bandeira (débito)". A mesma
   * limitação da Rede, pelo mesmo motivo de mercado. O modelo do ADR-0008 é,
   * portanto, crédito — em qualquer adquirente.
   */
  preAutorizacaoSoCredito: item(true, 'confirmado'),

  /**
   * `installments` é OBRIGATÓRIO no crédito. Não parcelamos recarga: sempre 1.
   */
  campoParcelas: item('installments', 'confirmado', 'obrigatório; nosso valor é sempre 1'),

  /** Nome na fatura do motorista. Só crédito, até 22 caracteres, sem acento. */
  campoNomeFatura: item('soft_descriptor', 'confirmado'),

  /** Valores em centavos, no campo `amount.value`. */
  campoValor: item('amount.value', 'confirmado', 'centavos inteiros: R$ 1.500,99 = 150099'),
  campoMoeda: item('amount.currency', 'confirmado', 'só BRL'),

  /**
   * A devolução NÃO tem estado próprio na cobrança.
   *
   * Os estados documentados são só seis; devolução aparece em
   * `amount.summary.refunded`. Quem olhar apenas o `status` verá `PAID` numa
   * cobrança já devolvida — o mesmo tipo de armadilha que a verificação da
   * Rede pegou na rodada 2.
   */
  devolucaoViaSummary: item('amount.summary.refunded', 'confirmado'),

  /**
   * Onde o webhook avisa a devolução: NÃO no webhook JSON.
   *
   * Eventos pós-transacionais (saldo disponível, devolvida, chargeback) chegam
   * na MESMA URL mas em outro formato — `notificationCode=...` estilo legado,
   * que exige um GET em ws.pagseguro.uol.com.br/v3 e responde XML. O
   * `parseWebhook` atual não entende esse formato; a conciliação de devolução
   * fica pela consulta ativa (`getPayment`) até esse fluxo ser implementado.
   */
  eventosPosTransacionaisLegados: item(true, 'confirmado', 'formato notificationCode + XML'),

  /** Como cadastrar a URL do webhook: por pedido, campo `notification_urls` (aceita UMA URL). */
  campoUrlNotificacao: item('notification_urls', 'confirmado'),

  /**
   * Onde entra o cartão criptografado pela chave pública.
   *
   * Confirmado na definição OpenAPI de Criar Pedido: `card.encrypted` —
   * "Criptograma do cartão criptografado". Continua sendo o **único** caminho
   * que o adapter aceita; número de cartão não tem entrada.
   */
  campoCartaoCriptografado: item('payment_method.card.encrypted', 'confirmado'),

  /**
   * A idempotência é do fornecedor, não improviso nosso: `x-idempotency-key`
   * no POST /orders — exatamente o cabeçalho que a base HTTP já envia.
   */
  cabecalhoIdempotencia: item('x-idempotency-key', 'confirmado'),

  /**
   * O pedido EXIGE o documento do comprador.
   *
   * `customer` é obrigatório e, dentro dele, `tax_id` (CPF/CNPJ) é
   * obrigatório. Consequência de produto real: no caminho online, o motorista
   * precisa informar CPF — diferente da Rede, que autoriza só com o token do
   * cartão. Na maquininha isso não existe (o SDK cuida).
   */
  clienteDocumentoObrigatorio: item('customer.tax_id', 'confirmado', 'CPF 11 ou CNPJ 14 dígitos'),

  /**
   * O e-mail do comprador TAMBÉM é obrigatório — descoberto na verificação.
   *
   * A definição OpenAPI marca `customer.email` como opcional; o sandbox
   * respondeu 400 `40001 · must not be null · customer.email`
   * (2026-08-03, rodada de Lucas). Mais um caso de papel ≠ realidade — é
   * exatamente para isso que a verificação existe.
   */
  clienteEmailObrigatorio: item(
    'customer.email',
    'confirmado',
    'a documentação diz opcional; o sandbox exige (erro 40001)',
  ),

  /**
   * `items` TAMBÉM é obrigatório na prática — segunda descoberta da
   * verificação (400 · 40001 · items, 2026-08-03). Todo pedido precisa dizer
   * o que vende; o nosso item é a recarga, quantidade 1, valor igual à
   * reserva.
   */
  itensObrigatorios: item(
    'items[]',
    'confirmado',
    'a documentação diz opcional; o sandbox exige (erro 40001)',
  ),

  /**
   * O cartão criptografado é de USO ÚNICO — terceira descoberta da
   * verificação (400 · 40002 · "ENCRYPTED CARD ALREADY USED", 2026-08-03).
   *
   * Cada blob vale para UMA autorização. Consequência de produto: quem
   * criptografa (o navegador ou o SDK) precisa gerar um criptograma novo por
   * pagamento — nunca guardar e reaproveitar. Guardar o blob no banco seria
   * inútil E perigoso; não guardamos.
   */
  criptogramaUsoUnico: item(true, 'confirmado', 'erro 40002 ao reusar'),

  /**
   * Com cartão criptografado, o nome do portador é obrigatório
   * ("Obrigatório para cobranças com 3DS e Criptografia").
   */
  nomePortadorObrigatorio: item('payment_method.card.holder.name', 'confirmado'),

  /** Erros vêm em `error_messages[]` com error, parameter_name e description. */
  formatoDeErros: item('error_messages[]', 'confirmado'),

  /** Cabeçalho que carrega a assinatura do webhook. */
  cabecalhoAssinatura: item('x-authenticity-token', 'confirmado'),

  /**
   * A fórmula da assinatura — e ela NÃO é HMAC.
   *
   * A página oficial define: `sha256("{token}-{payload}")`, em hexadecimal,
   * onde `token` é o token da conta e `payload` são os bytes crus do corpo
   * (qualquer formatação quebra o hash). Um HMAC aqui recusaria todo webhook
   * legítimo — silenciosamente.
   */
  formulaAssinatura: item('sha256(token + "-" + corpoCru) em hex', 'confirmado'),

  /**
   * Estados do fornecedor → estados nossos.
   *
   * Os seis estados documentados no Objeto Charge — e SÓ eles. Devolução não é
   * estado: é `summary.refunded` (ver `devolucaoViaSummary`).
   */
  mapaDeEstados: item<Record<string, PaymentStatus>>(
    {
      AUTHORIZED: 'AUTHORIZED',
      PAID: 'CAPTURED',
      IN_ANALYSIS: 'PENDING',
      WAITING: 'PENDING',
      DECLINED: 'DECLINED',
      CANCELED: 'VOIDED',
    },
    'confirmado',
  ),
} as const;

/** Itens que ainda precisam ser confirmados contra a documentação. */
export function pendenciasDoContrato(): string[] {
  return Object.entries(CONTRATO)
    .filter(([, item]) => (item as ItemContrato<unknown>).procedencia === 'a confirmar')
    .map(([chave]) => chave);
}

const CAPABILITIES: PaymentCapabilities = {
  preAuthorization: true,
  partialCapture: true,
  voidAuthorization: true,
  refund: true,
  partialRefund: true,
  // Só crédito: o Objeto Charge diz que `capture: false` é indisponível para
  // débito — sem pré-autorização não existe o nosso modelo. Pix entra quando o
  // fluxo de devolução dele for confirmado; declarar antes faria o sistema
  // oferecer ao motorista algo que o adapter não sabe fazer.
  methods: ['CREDIT_CARD'],
  initiatedBy: 'backend',
  // 6 a 29 dias conforme a bandeira; assumimos o pior caso para o alerta do
  // risco R-23 disparar cedo o bastante.
  authorizationValidityDays: 6,
};

export interface PagBankConfig extends HttpProviderConfig {
  /**
   * Só `true` depois de o adapter ter sido exercitado contra o sandbox e a
   * suíte de conformidade ter passado. Ver `docs/payments/fase-7-o-que-falta.md`.
   */
  verificado?: boolean;
}

export class PagBankProvider extends HttpPaymentProvider implements PaymentProvider {
  readonly name = 'pagbank';
  readonly capabilities = CAPABILITIES;

  /** Falso enquanto o contrato não for confirmado contra o sandbox. */
  readonly verificado: boolean;

  constructor(config: PagBankConfig) {
    super(config);
    this.verificado = config.verificado ?? false;
  }

  /**
   * Pré-autoriza usando um cartão CRIPTOGRAFADO — nunca o número.
   *
   * O PagBank aceita o cartão em claro, e nós não. O caminho aceito é o blob
   * cifrado no cliente com a chave pública (`CONTRATO.criarChavePublica`),
   * entregue em `metadata.encryptedCard`. Mesma regra do adapter da Rede, pelo
   * mesmo motivo: número completo passando pelo nosso servidor é o que a seção
   * 12 do briefing proíbe.
   */
  async authorize(input: AuthorizeInput): Promise<PaymentResult> {
    this.exigirVerificacao();
    assertCents(input.amountCents, 'amountCents');

    if (input.method !== 'CREDIT_CARD') {
      // Não é escolha nossa: o Objeto Charge documenta `capture: false` como
      // indisponível para débito. Mesma limitação da Rede.
      throw new PaymentProviderError(
        `o PagBank não faz pré-autorização em ${input.method} — só crédito`,
        'METHOD_NOT_SUPPORTED',
        false,
      );
    }

    const encryptedCard = input.metadata?.encryptedCard;
    if (typeof encryptedCard !== 'string' || !encryptedCard) {
      throw new PaymentProviderError(
        'a autorização pelo PagBank exige um cartão criptografado ' +
          '(metadata.encryptedCard, gerado no cliente com a chave pública). ' +
          'Número de cartão nunca passa pelo nosso servidor (briefing seção 12).',
        'MISSING_CARD_TOKEN',
        false,
      );
    }

    // Exigências documentadas do Criar Pedido, cobradas aqui na porta — a
    // alternativa seria um 400 do fornecedor com o motorista esperando na tela.
    const customerTaxId = input.metadata?.customerTaxId;
    const holderName = input.metadata?.holderName;
    if (typeof customerTaxId !== 'string' || !/^\d{11}(\d{3})?$/.test(customerTaxId)) {
      throw new PaymentProviderError(
        'o PagBank exige o documento do comprador (metadata.customerTaxId, ' +
          'CPF 11 ou CNPJ 14 dígitos) — customer.tax_id é obrigatório no pedido.',
        'MISSING_CUSTOMER_TAX_ID',
        false,
      );
    }
    if (typeof holderName !== 'string' || !holderName.trim()) {
      throw new PaymentProviderError(
        'o PagBank exige o nome do portador (metadata.holderName) em cobranças ' +
          'com cartão criptografado.',
        'MISSING_HOLDER_NAME',
        false,
      );
    }
    // A documentação marca o e-mail como opcional; o sandbox exige (40001).
    const customerEmail = input.metadata?.customerEmail;
    if (typeof customerEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
      throw new PaymentProviderError(
        'o PagBank exige o e-mail do comprador (metadata.customerEmail) — a ' +
          'documentação diz opcional, mas o sandbox recusa sem ele (erro 40001).',
        'MISSING_CUSTOMER_EMAIL',
        false,
      );
    }

    const { body } = await this.req<Record<string, unknown>>('POST', CONTRATO.criarPedido.valor, {
      idempotencyKey: input.idempotencyKey,
      body: {
        reference_id: input.idempotencyKey,
        customer: {
          name: holderName,
          email: customerEmail,
          [CONTRATO.clienteDocumentoObrigatorio.valor.split('.')[1]]: customerTaxId,
        },
        // Obrigatório na prática (40001). O que vendemos é a recarga; o
        // valor do item é a reserva — a captura menor vem depois.
        items: [
          {
            reference_id: input.idempotencyKey,
            name: (input.description ?? 'Recarga de veículo elétrico').slice(0, 200),
            quantity: 1,
            unit_amount: input.amountCents,
          },
        ],
        charges: [
          {
            reference_id: input.idempotencyKey,
            description: input.description ?? 'Recarga de veículo elétrico',
            amount: { value: input.amountCents, currency: 'BRL' },
            payment_method: {
              type: 'CREDIT_CARD',
              // Obrigatório no crédito. Recarga não parcela: sempre 1.
              [CONTRATO.campoParcelas.valor]: 1,
              // O campo que faz a diferença entre reservar e cobrar.
              [CONTRATO.campoPreAutorizacao.valor]: false,
              // Nome na fatura: até 22 caracteres, sem caracteres especiais.
              [CONTRATO.campoNomeFatura.valor]: (input.description ?? 'Recarga VE').slice(0, 22),
              card: {
                encrypted: encryptedCard,
                // Obrigatório com criptografia.
                holder: { name: holderName },
              },
            },
          },
        ],
      },
    });

    return this.toResult(this.primeiraCobranca(body), input.amountCents);
  }

  /**
   * Busca a chave pública de cartão da conta.
   *
   * Não exige `verificado`: o caminho está confirmado no portal e esta é
   * justamente a primeira chamada a fazer quando as credenciais chegarem —
   * bloqueá-la só atrapalharia o dia de ligar o sandbox. Mesmo raciocínio da
   * verificação de assinatura.
   *
   * A chave é pública por definição; não há segredo a proteger aqui.
   */
  async chavePublicaDeCartao(): Promise<string> {
    const { body } = await this.req<Record<string, unknown>>(
      'GET',
      CONTRATO.consultarChavePublica.valor,
    );

    const chave = body?.public_key;
    if (typeof chave !== 'string' || !chave) {
      throw new PaymentProviderError(
        'o PagBank não devolveu uma chave pública de cartão',
        'MALFORMED',
        false,
      );
    }

    return chave;
  }

  async capture(providerPaymentId: string, amountCents: Cents): Promise<PaymentResult> {
    this.exigirVerificacao();
    assertCents(amountCents, 'amountCents');

    const { body } = await this.req<Record<string, unknown>>(
      'POST',
      CONTRATO.capturar.valor.replace('{chargeId}', providerPaymentId),
      {
        idempotencyKey: `capture-${providerPaymentId}-${amountCents}`,
        // O corpo documentado é só { amount: { value } } — sem currency.
        body: { amount: { value: amountCents } },
      },
    );

    return this.toResult(body);
  }

  /**
   * Desfaz a pré-autorização.
   *
   * Todos os exemplos oficiais do cancelamento enviam `amount` — e na Rede a
   * verificação provou que corpo sem valor toma 400. Aqui não sabemos o valor
   * reservado sem perguntar, então: consulta, e cancela pelo valor cheio.
   */
  async voidPayment(providerPaymentId: string): Promise<PaymentResult> {
    this.exigirVerificacao();

    const atual = await this.getPayment(providerPaymentId);

    const { body } = await this.req<Record<string, unknown>>(
      'POST',
      CONTRATO.cancelar.valor.replace('{chargeId}', providerPaymentId),
      {
        idempotencyKey: `void-${providerPaymentId}`,
        body: { amount: { value: atual.amountAuthorizedCents } },
      },
    );

    return this.toResult(body);
  }

  /**
   * Devolve valor capturado — mesmo caminho do cancelamento, com `amount`.
   *
   * Sem `amountCents`, o valor é descoberto na consulta: o que foi capturado
   * menos o que já foi devolvido. Mesma solução que a verificação da Rede
   * exigiu na rodada 1.
   */
  async refund(providerPaymentId: string, amountCents?: Cents): Promise<PaymentResult> {
    this.exigirVerificacao();

    let valor = amountCents === undefined ? undefined : assertCents(amountCents, 'amountCents');
    if (valor === undefined) {
      const atual = await this.getPayment(providerPaymentId);
      const restante = atual.amountCapturedCents - atual.amountRefundedCents;
      if (restante <= 0) {
        throw new PaymentProviderError(
          `não há valor a devolver na cobrança ${providerPaymentId} ` +
            `(capturado ${atual.amountCapturedCents}, devolvido ${atual.amountRefundedCents})`,
          'NOTHING_TO_REFUND',
          false,
        );
      }
      valor = assertCents(restante, 'restante');
    }

    const { body } = await this.req<Record<string, unknown>>(
      'POST',
      CONTRATO.devolver.valor.replace('{chargeId}', providerPaymentId),
      {
        idempotencyKey: `refund-${providerPaymentId}-${valor}`,
        body: { amount: { value: valor } },
      },
    );

    return this.toResult(body);
  }

  async getPayment(providerPaymentId: string): Promise<PaymentResult> {
    this.exigirVerificacao();

    const { body } = await this.req<Record<string, unknown>>(
      'GET',
      CONTRATO.consultar.valor.replace('{chargeId}', providerPaymentId),
    );

    return this.toResult(body);
  }

  /**
   * A verificação de assinatura **não** exige `verificado`.
   *
   * A fórmula do PagBank não é HMAC: é `sha256("{token}-{payload}")` em hex,
   * sobre os bytes crus do corpo, com o token da conta como prefixo
   * (`CONTRATO.formulaAssinatura`). O HMAC que este método usava antes
   * recusaria todo webhook legítimo — silenciosamente, que é o pior jeito.
   *
   * O segredo é o token da conta. `webhookSecret` permite separá-lo do token
   * de API se um dia forem diferentes; sem ele, usa-se o próprio token.
   */
  async verifyWebhook(
    _payload: unknown,
    headers: Record<string, string>,
    rawBody?: Buffer,
  ): Promise<boolean> {
    const assinaturaRecebida = headers[CONTRATO.cabecalhoAssinatura.valor];
    if (!rawBody || !assinaturaRecebida) return false;

    const segredo = this.config.webhookSecret ?? this.config.token;
    const esperada = createHash('sha256')
      .update(Buffer.concat([Buffer.from(`${segredo}-`), rawBody]))
      .digest('hex');

    const a = Buffer.from(esperada);
    const b = Buffer.from(assinaturaRecebida);
    // Comparação em tempo constante — mesma razão do resto do sistema.
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async parseWebhook(payload: unknown): Promise<PaymentWebhookEvent> {
    const p = payload as Record<string, unknown>;
    const cobranca = this.primeiraCobranca(p);

    const eventId = typeof p?.id === 'string' ? p.id : undefined;
    const chargeId = typeof cobranca?.id === 'string' ? cobranca.id : undefined;

    if (!eventId || !chargeId) {
      throw new PaymentProviderError(
        'webhook sem identificador de evento ou de cobrança',
        'MALFORMED',
        false,
      );
    }

    return {
      eventId,
      providerPaymentId: chargeId,
      status: this.mapearEstado(cobranca),
      amountCents:
        this.valorDe(cobranca, 'amount.summary.paid') ?? this.valorDe(cobranca, 'amount.value'),
      occurredAt: new Date(),
      raw: payload,
    };
  }

  // -------------------------------------------------------------------------

  /**
   * Trava de segurança.
   *
   * O adapter está escrito, mas o contrato não foi conferido. Deixá-lo operar
   * significaria descobrir a divergência com dinheiro de motorista.
   */
  /**
   * Toda chamada ao PagBank passa por aqui: o gateway deles responde 406 a
   * `Accept: application/json` nas consultas (diagnóstico da verificação de
   * 2026-08-03) e aceita `*\/*`. O cabeçalho vai por último no merge da base,
   * então esta sobrescrita vale sempre. Escopado ao PagBank de propósito — a
   * Rede foi verificada 8/8 com o cabeçalho padrão e não deve mudar junto.
   */
  private req<T>(
    metodo: 'GET' | 'POST' | 'PUT',
    caminho: string,
    opcoes: { body?: unknown; idempotencyKey?: string; headers?: Record<string, string> } = {},
  ) {
    return this.request<T>(metodo, caminho, {
      ...opcoes,
      headers: { Accept: '*/*', ...(opcoes.headers ?? {}) },
    });
  }

  private exigirVerificacao(): void {
    if (this.verificado) return;

    const pendentes = pendenciasDoContrato();
    // Contrato todo lido ≠ contrato exercitado. A Rede tinha o contrato
    // "fechado" no papel e a verificação achou três erros reais. A trava só
    // abre depois de o sandbox aprovar (pnpm verificar:pagbank).
    const situacao =
      pendentes.length > 0
        ? `Itens pendentes no contrato: ${pendentes.join(', ')}.`
        : 'O contrato está todo confirmado na documentação, mas ainda não foi ' +
          'exercitado contra o sandbox (pnpm verificar:pagbank).';

    throw new PaymentProviderError(
      `O adapter do PagBank ainda não foi verificado contra o sandbox. ${situacao} ` +
        'Ver docs/payments/fase-7-o-que-falta.md.',
      'ADAPTER_NOT_VERIFIED',
      false,
    );
  }

  private primeiraCobranca(body: Record<string, unknown> | undefined): Record<string, unknown> {
    if (!body) return {};
    const charges = body.charges;
    if (Array.isArray(charges) && charges.length > 0) {
      return charges[0] as Record<string, unknown>;
    }
    return body;
  }

  /**
   * Estado real da cobrança — status + summary.
   *
   * A devolução não tem estado próprio no PagBank: uma cobrança devolvida
   * continua `PAID`, com o valor em `summary.refunded`. Quem mapear só o
   * `status` mostraria "cobrado" para um motorista já ressarcido — a mesma
   * armadilha que a verificação da Rede pegou na rodada 2, no sentido oposto.
   */
  private mapearEstado(cobranca: Record<string, unknown>): PaymentStatus {
    const bruto = typeof cobranca.status === 'string' ? cobranca.status.toUpperCase() : '';
    // Estado desconhecido vira FAILED, e não algo otimista: tratar o que não se
    // entende como sucesso é como se confirma recarga sem pagamento.
    const base = CONTRATO.mapaDeEstados.valor[bruto] ?? 'FAILED';

    // A página oficial de cancelamento mostra os dois lados da armadilha:
    // devolução parcial deixa a cobrança PAID (refunded=500), e devolução
    // TOTAL deixa CANCELED (paid=1000, refunded=1000). Sem olhar o summary,
    // uma devolução total viraria "reserva cancelada, nada foi cobrado" — e
    // um cancelamento de pré-autorização nunca tem `paid`, então o guarda
    // `capturado > 0` separa os dois casos. Mesma lição da Rede, rodada 2.
    const capturado = this.valorDe(cobranca, 'amount.summary.paid') ?? 0;
    const devolvido = this.valorDe(cobranca, 'amount.summary.refunded') ?? 0;
    if ((base === 'CAPTURED' || base === 'VOIDED') && capturado > 0 && devolvido > 0) {
      return devolvido >= capturado ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    }

    return base;
  }

  /** Lê um valor em centavos por caminho pontilhado, sem confiar no formato. */
  private valorDe(objeto: Record<string, unknown>, caminho: string): number | undefined {
    const valor = caminho
      .split('.')
      .reduce<unknown>((atual, chave) => (atual as Record<string, unknown>)?.[chave], objeto);

    return typeof valor === 'number' && Number.isInteger(valor) ? valor : undefined;
  }

  private toResult(cobranca: Record<string, unknown>, autorizadoFallback = 0): PaymentResult {
    const status = this.mapearEstado(cobranca);
    const autorizado = this.valorDe(cobranca, 'amount.value') ?? autorizadoFallback;
    // O summary mora DENTRO de amount (Objeto Charge, lido em 2026-08-03). Os
    // caminhos antigos ('summary.paid') liam sempre zero — capturas sumiriam.
    const capturado = this.valorDe(cobranca, 'amount.summary.paid') ?? 0;
    const devolvido = this.valorDe(cobranca, 'amount.summary.refunded') ?? 0;

    const cartao = (cobranca.payment_method as Record<string, unknown>)?.card as
      Record<string, unknown> | undefined;

    return {
      ok: status !== 'DECLINED' && status !== 'FAILED',
      status,
      providerPaymentId: String(cobranca.id ?? ''),
      amountAuthorizedCents: autorizado,
      amountCapturedCents: capturado,
      amountRefundedCents: devolvido,
      instrument: {
        cardBrand: typeof cartao?.brand === 'string' ? cartao.brand : undefined,
        // Só os quatro últimos. O número completo nunca entra (seção 12).
        cardLastFour: typeof cartao?.last_digits === 'string' ? cartao.last_digits : undefined,
      },
      message: this.mensagemDe(status),
      // O código do motivo (padrão ABECS) — mais útil para diagnóstico do que o
      // status, que já vai mapeado acima. 20000 = sucesso.
      providerCode: (() => {
        const codigo = (cobranca.payment_response as Record<string, unknown>)?.code;
        if (typeof codigo === 'string' || typeof codigo === 'number') return String(codigo);
        return typeof cobranca.status === 'string' ? cobranca.status : undefined;
      })(),
      raw: cobranca,
    };
  }

  /** Frase pronta para a tela do motorista (briefing seção 14). */
  private mensagemDe(status: PaymentStatus): string {
    switch (status) {
      case 'AUTHORIZED':
        return 'Valor reservado no cartão.';
      case 'CAPTURED':
        return 'Valor cobrado.';
      case 'VOIDED':
        return 'Reserva cancelada: nada foi cobrado.';
      case 'REFUNDED':
      case 'PARTIALLY_REFUNDED':
        return 'Devolução realizada.';
      case 'DECLINED':
        return 'Pagamento recusado pelo emissor do cartão.';
      case 'PENDING':
        return 'Pagamento em análise.';
      default:
        return 'Não foi possível concluir o pagamento.';
    }
  }
}
