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
 * Adapter do e.Rede (Rede/Itaú).
 *
 * Diferente do adapter do PagBank, este foi escrito **com o contrato lido**: o
 * Integration Manual v1.38 (23/03/2026) foi trazido por você e lido na íntegra
 * em 2026-07-31 — ver `docs/payments/rede-e-rede-contrato.md`. Por isso quase
 * todo item do `CONTRATO_REDE` está marcado `confirmado`.
 *
 * Ainda assim, **ler não é o mesmo que exercitar**: enquanto a suíte de
 * conformidade não passar contra o sandbox real, `BORA_REDE_VERIFIED` fica
 * falso e o adapter recusa toda operação. Manual desatualizado, sandbox
 * divergente do manual e erro nosso de leitura são três formas de perder
 * dinheiro que só o teste real elimina.
 *
 * As decisões que vieram do manual, e não de preferência nossa:
 *
 *  * **OAuth 2.0 obrigatório**, token de 24 minutos, e SOMENTE rotas V2 —
 *    V1 com Bearer devolve `370`. O gerenciador de token está neste arquivo.
 *  * **PV sem zeros à esquerda**, senão `401 invalid_client`.
 *  * **Valores em centavos** ("R$10.00 = 1000") — igual ao ADR-0005.
 *  * A idempotência é o `reference` (nosso identificador, ≤16, único): não há
 *    cabeçalho de idempotência; repetir o `reference` devolve o erro 42, e a
 *    recuperação é consultar por ele.
 *  * **Devolução é assíncrona**: código 360 significa "recebido", não "feito".
 *    Por isso toda operação de cancelamento/devolução é seguida de uma
 *    consulta — a verdade é sempre a consulta por `tid`.
 */

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
 * O contrato do fornecedor, em um só lugar.
 *
 * Procedência `confirmado` = lido no Integration Manual v1.38 ou na coleção
 * Postman oficial. O que restou `a confirmar` depende do credenciamento, não
 * de documentação.
 */
export const CONTRATO_REDE = {
  baseUrlSandbox: item('https://sandbox-erede.useredecloud.com.br', 'confirmado'),
  baseUrlProducao: item('https://api.userede.com.br/erede', 'confirmado'),
  oauthUrlSandbox: item('https://rl7-sandbox-api.useredecloud.com.br', 'confirmado'),
  oauthUrlProducao: item('https://api.userede.com.br/redelabs', 'confirmado'),

  gerarToken: item(
    '/oauth2/token',
    'confirmado',
    'Basic base64(pv:chave), grant_type=client_credentials',
  ),
  autorizar: item('/v2/transactions', 'confirmado', 'capture:false = pré-autoriza'),
  capturar: item(
    '/v2/transactions/{tid}',
    'confirmado',
    'PUT com { amount } — pode ser MENOR que o autorizado',
  ),
  cancelar: item(
    '/v2/transactions/{tid}/refunds',
    'confirmado',
    'pré-captura: só total; pós: parcial ou total',
  ),
  consultar: item('/v2/transactions/{tid}', 'confirmado'),
  consultarPorReferencia: item(
    '/v2/transactions?reference={reference}',
    'confirmado',
    'janela de 60 dias',
  ),

  campoValor: item('amount', 'confirmado', 'centavos inteiros: R$10,00 = 1000'),
  codigoSucesso: item('00', 'confirmado'),
  codigoDevolucaoSincrona: item('359', 'confirmado', 'Refund successful'),
  codigoDevolucaoRecebida: item(
    '360',
    'confirmado',
    'recebido ≠ feito — reconsultar até Done/Denied',
  ),
  codigoReferenciaDuplicada: item(
    '42',
    'confirmado',
    'reference já existe — recuperar consultando por ele',
  ),

  /** Estados da consulta → estados nossos. */
  mapaDeEstados: item<Record<string, PaymentStatus>>(
    {
      // "Pending" numa transação de cartão é a pré-autorização aprovada e ainda
      // não capturada (manual, §Delay Capture 3.1).
      PENDING: 'AUTHORIZED',
      APPROVED: 'CAPTURED',
      DENIED: 'DECLINED',
      CANCELED: 'VOIDED',
    },
    'confirmado',
  ),

  /**
   * Prazo até a pré-autorização não capturada se cancelar sozinha. O manual só
   * diz que "varia conforme o ramo do estabelecimento" — o número do NOSSO
   * ramo é pergunta obrigatória no credenciamento (risco R-23).
   */
  prazoPreAutorizacaoDias: item(
    1,
    'a confirmar',
    'pior caso assumido até a Rede informar o do nosso ramo',
  ),

  /**
   * O webhook da Rede NÃO tem assinatura HMAC sobre o corpo — só um token fixo
   * (Bearer/Basic) que registramos no portal. Por isso ele é tratado como
   * aviso: a verdade é a consulta por `tid`.
   */
  webhookSemAssinatura: item(true, 'confirmado'),
} as const;

/** Itens que ainda precisam ser confirmados (agora, só no credenciamento). */
export function pendenciasDoContratoRede(): string[] {
  return Object.entries(CONTRATO_REDE)
    .filter(([, i]) => (i as ItemContrato<unknown>).procedencia === 'a confirmar')
    .map(([chave]) => chave);
}

const CAPABILITIES: PaymentCapabilities = {
  preAuthorization: true,
  partialCapture: true,
  voidAuthorization: true,
  refund: true,
  partialRefund: true,
  /**
   * Só crédito, por enquanto. Débito online exige 3DS obrigatório (manual),
   * que pede interação do portador — fluxo que ainda não construímos. E Pix
   * pelo e.Rede exige conta Itaú e tem fluxo próprio de QR Code.
   */
  methods: ['CREDIT_CARD'],
  initiatedBy: 'backend',
  authorizationValidityDays: CONTRATO_REDE.prazoPreAutorizacaoDias.valor,
};

export interface RedeConfig extends Omit<
  HttpProviderConfig,
  'baseUrl' | 'token' | 'webhookSecret'
> {
  /** Número de afiliação (PV). Zeros à esquerda são removidos (401 invalid_client). */
  pv: string;
  /** Chave de integração gerada no portal Use Rede (o `clientSecret`). */
  integrationKey: string;
  /** Raiz da API transacional. Padrão: sandbox. */
  baseUrl?: string;
  /** Raiz do serviço de token OAuth. Padrão: sandbox. */
  oauthUrl?: string;
  /**
   * Token fixo que registramos no portal para a URL de notificação. A Rede não
   * assina o corpo — este token é a única autenticação do webhook.
   */
  webhookToken?: string;
  /** Só `true` depois de a suíte de conformidade passar contra o sandbox. */
  verificado?: boolean;
}

export class RedeProvider extends HttpPaymentProvider implements PaymentProvider {
  readonly name = 'rede';
  readonly capabilities = CAPABILITIES;
  readonly verificado: boolean;

  private readonly pv: string;
  private readonly oauthUrl: string;

  /** Token OAuth corrente. Vale 24 min; renovamos com folga. */
  private tokenOauth: { valor: string; expiraEm: number } | null = null;

  constructor(config: RedeConfig) {
    super({
      ...config,
      baseUrl: config.baseUrl ?? CONTRATO_REDE.baseUrlSandbox.valor,
      // A "credencial" da base é a chave de integração: é o que o `redigir`
      // da classe-mãe limpa de qualquer mensagem de erro.
      token: config.integrationKey,
      webhookSecret: config.webhookToken,
    });

    // Manual: PV com zero à esquerda devolve 401 invalid_client.
    this.pv = config.pv.replace(/^0+/, '');
    if (!this.pv) throw new Error('pv é obrigatório');

    this.oauthUrl = (config.oauthUrl ?? CONTRATO_REDE.oauthUrlSandbox.valor).replace(/\/+$/, '');
    this.verificado = config.verificado ?? false;
  }

  // ---------------------------------------------------------------------------
  // Operações
  // ---------------------------------------------------------------------------

  /**
   * Pré-autoriza usando um TOKEN de cartão — nunca o número.
   *
   * A API da Rede aceita `cardNumber`, mas nós não: número completo passando
   * pelo nosso servidor é exatamente o que a seção 12 do briefing proíbe (e o
   * que expandiria o escopo PCI). O caminho aceito é o token gerado fora do
   * nosso processo — pelo SDK da maquininha ou por tokenização no navegador —
   * entregue em `metadata.cardToken`.
   */
  async authorize(input: AuthorizeInput): Promise<PaymentResult> {
    this.exigirVerificacao();
    assertCents(input.amountCents, 'amountCents');

    if (input.method !== 'CREDIT_CARD') {
      throw new PaymentProviderError(
        `o adapter da Rede ainda não executa ${input.method} — débito online exige 3DS`,
        'METHOD_NOT_SUPPORTED',
        false,
      );
    }

    const cardToken = input.metadata?.cardToken;
    if (typeof cardToken !== 'string' || !cardToken) {
      throw new PaymentProviderError(
        'a autorização pela Rede exige um token de cartão (metadata.cardToken). ' +
          'Número de cartão nunca passa pelo nosso servidor (briefing seção 12).',
        'MISSING_CARD_TOKEN',
        false,
      );
    }

    const reference = this.referenceDe(input.idempotencyKey);
    const tokenCryptogram = input.metadata?.tokenCryptogram;

    let body: Record<string, unknown>;
    try {
      ({ body } = await this.requestRede<Record<string, unknown>>(
        'POST',
        CONTRATO_REDE.autorizar.valor,
        {
          capture: false,
          kind: 'credit',
          reference,
          [CONTRATO_REDE.campoValor.valor]: input.amountCents,
          cardToken,
          ...(typeof tokenCryptogram === 'string' ? { tokenCryptogram } : {}),
          softDescriptor: input.description?.slice(0, 18),
        },
      ));
    } catch (error) {
      // `reference` repetido = a nossa retentativa depois de resposta perdida.
      // A transação original existe; recuperá-la é o comportamento idempotente.
      const recuperada = await this.recuperarSeDuplicada(error, reference);
      if (recuperada) return recuperada;
      throw error;
    }

    return this.deResposta(body, input.amountCents);
  }

  async capture(providerPaymentId: string, amountCents: Cents): Promise<PaymentResult> {
    this.exigirVerificacao();
    assertCents(amountCents, 'amountCents');

    const { body } = await this.requestRede<Record<string, unknown>>(
      'PUT',
      CONTRATO_REDE.capturar.valor.replace('{tid}', providerPaymentId),
      { [CONTRATO_REDE.campoValor.valor]: amountCents },
    );

    const resultado = this.deResposta(body, amountCents);

    if (resultado.ok) {
      return { ...resultado, status: 'CAPTURED', amountCapturedCents: amountCents };
    }
    return resultado;
  }

  /**
   * Cancela a reserva não capturada. Na Rede é o mesmo caminho da devolução,
   * e **só o valor total** é aceito antes da captura (manual, §Cancellation).
   */
  async voidPayment(providerPaymentId: string): Promise<PaymentResult> {
    this.exigirVerificacao();
    return this.devolverEConsultar(providerPaymentId, undefined);
  }

  async refund(providerPaymentId: string, amountCents?: Cents): Promise<PaymentResult> {
    this.exigirVerificacao();
    return this.devolverEConsultar(
      providerPaymentId,
      amountCents === undefined ? undefined : assertCents(amountCents),
    );
  }

  async getPayment(providerPaymentId: string): Promise<PaymentResult> {
    this.exigirVerificacao();

    const { body } = await this.requestRede<Record<string, unknown>>(
      'GET',
      CONTRATO_REDE.consultar.valor.replace('{tid}', providerPaymentId),
    );

    return this.deConsulta(body);
  }

  // ---------------------------------------------------------------------------
  // Webhook — aviso, não verdade
  // ---------------------------------------------------------------------------

  /**
   * A Rede não assina o corpo. A única autenticação é o token fixo que NÓS
   * registramos no portal, devolvido no cabeçalho `authorization` de cada
   * notificação. Comparação em tempo constante; sem token configurado, recusa.
   */
  async verifyWebhook(
    _payload: unknown,
    headers: Record<string, string>,
    _rawBody?: Buffer,
  ): Promise<boolean> {
    const esperado = this.config.webhookSecret;
    if (!esperado) return false;

    const recebido = headers['authorization'] ?? headers['Authorization'];
    if (!recebido) return false;

    // Hash antes de comparar: iguala os tamanhos (exigência do timingSafeEqual)
    // sem vazar, pela recusa imediata, o comprimento do token.
    const a = createHash('sha256').update(esperado).digest();
    const b = createHash('sha256').update(recebido.trim()).digest();

    return timingSafeEqual(a, b);
  }

  /**
   * Normaliza a notificação — que é só um AVISO. Quem consome este evento deve
   * reconsultar por `tid` antes de mudar qualquer estado: sem assinatura no
   * corpo, o conteúdo não é prova de nada.
   */
  async parseWebhook(payload: unknown): Promise<PaymentWebhookEvent> {
    const p = payload as Record<string, unknown>;
    const data = p?.data as Record<string, unknown> | undefined;

    const tid =
      (typeof p?.tid === 'string' && p.tid) ||
      (typeof data?.id === 'string' && data.id) ||
      undefined;

    if (!tid) {
      throw new PaymentProviderError('notificação sem tid', 'MALFORMED', false);
    }

    const refundId = typeof p?.refundId === 'string' ? p.refundId : undefined;
    const eventos = Array.isArray(p?.events) ? (p.events as string[]) : [];
    const statusBruto = typeof p?.status === 'string' ? p.status.toUpperCase() : '';

    let status: PaymentStatus;
    if (statusBruto === 'DONE' || eventos.includes('PV.REFUND_PIX')) {
      status = 'REFUNDED';
    } else if (statusBruto === 'DENIED') {
      // Devolução negada: o dinheiro continua cobrado.
      status = 'CAPTURED';
    } else if (statusBruto === 'PROCESSING') {
      status = 'PENDING';
    } else if (eventos.includes('PV.UPDATE_TRANSACTION_PIX')) {
      status = 'CAPTURED';
    } else {
      status = 'PENDING';
    }

    return {
      // O refundId identifica a devolução; sem ele, tid + evento é o melhor
      // identificador disponível para a idempotência do webhook.
      eventId: refundId ?? `${tid}:${eventos[0] ?? statusBruto ?? 'evento'}`,
      providerPaymentId: tid,
      status,
      amountCents:
        typeof p?.amount === 'number' && Number.isInteger(p.amount) ? p.amount : undefined,
      occurredAt: new Date(),
      raw: payload,
    };
  }

  // ---------------------------------------------------------------------------
  // OAuth
  // ---------------------------------------------------------------------------

  /**
   * Token de acesso válido, renovando quando preciso.
   *
   * O manual manda renovar entre 15 e 23 minutos de um token que vale 24.
   * Usamos 80% da validade informada — a mesma proporção, sem cravar minutos.
   */
  private async tokenValido(): Promise<string> {
    if (this.tokenOauth && Date.now() < this.tokenOauth.expiraEm) {
      return this.tokenOauth.valor;
    }

    const basic = Buffer.from(`${this.pv}:${this.config.token}`).toString('base64');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const resposta = await this.config.fetchImpl(
        `${this.oauthUrl}${CONTRATO_REDE.gerarToken.valor}`,
        {
          method: 'POST',
          signal: controller.signal,
          headers: {
            Authorization: `Basic ${basic}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: 'grant_type=client_credentials',
        },
      );

      if (!resposta.ok) {
        // 401 aqui é credencial errada — insistir não resolve.
        throw new PaymentProviderError(
          `a autenticação na Rede falhou (${resposta.status})`,
          'AUTH_FAILED',
          resposta.status >= 500,
        );
      }

      const corpo = (await resposta.json()) as { access_token?: string; expires_in?: number };

      if (!corpo.access_token) {
        throw new PaymentProviderError('a Rede não devolveu access_token', 'AUTH_FAILED', false);
      }

      const validadeSegundos = corpo.expires_in ?? 24 * 60;
      this.tokenOauth = {
        valor: corpo.access_token,
        expiraEm: Date.now() + validadeSegundos * 1000 * 0.8,
      };

      return this.tokenOauth.valor;
    } catch (error) {
      if (error instanceof PaymentProviderError) throw error;

      const abortou = error instanceof Error && error.name === 'AbortError';
      throw new PaymentProviderError(
        abortou
          ? `a Rede não respondeu a autenticação em ${this.config.timeoutMs} ms`
          : this.redigir(error instanceof Error ? error.message : String(error)),
        abortou ? 'TIMEOUT' : 'NETWORK',
        true,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /** Chamada à API transacional com o Bearer dinâmico do OAuth. */
  private async requestRede<T>(
    metodo: 'GET' | 'POST' | 'PUT',
    caminho: string,
    body?: unknown,
  ): Promise<{ status: number; body: T }> {
    const token = await this.tokenValido();

    // O `Authorization` daqui SOBRESCREVE o da classe-mãe (os headers extras
    // são aplicados por último) — a base colocaria a chave de integração, que
    // não é o que a API transacional espera.
    return this.request<T>(metodo, caminho, {
      body,
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  /** Remove também o token OAuth corrente de qualquer mensagem. */
  protected override redigir(texto: string): string {
    let limpo = super.redigir(texto);
    if (this.tokenOauth?.valor) {
      limpo = limpo.split(this.tokenOauth.valor).join('[REDIGIDO]');
    }
    return limpo;
  }

  // ---------------------------------------------------------------------------
  // Apoio
  // ---------------------------------------------------------------------------

  private exigirVerificacao(): void {
    if (this.verificado) return;

    throw new PaymentProviderError(
      'O adapter da Rede ainda não foi verificado contra o sandbox. ' +
        `Pendências do contrato: ${pendenciasDoContratoRede().join(', ') || 'nenhuma'} — ` +
        'falta rodar a suíte de conformidade com as credenciais reais. ' +
        'Ver docs/payments/rede-e-rede-contrato.md.',
      'ADAPTER_NOT_VERIFIED',
      false,
    );
  }

  /**
   * `reference` determinístico a partir da chave de idempotência.
   *
   * A Rede limita a 16 caracteres e exige unicidade — e é o `reference`, não um
   * cabeçalho, que faz a idempotência lá. Determinístico de propósito: a mesma
   * chave produz o mesmo reference, então a retentativa esbarra no erro 42 e
   * recupera a transação original em vez de criar outra.
   */
  private referenceDe(idempotencyKey: string): string {
    return createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 16);
  }

  private async recuperarSeDuplicada(
    error: unknown,
    reference: string,
  ): Promise<PaymentResult | null> {
    if (!(error instanceof PaymentProviderError)) return null;

    const corpo = error.raw as Record<string, unknown> | undefined;
    const codigo = typeof corpo?.returnCode === 'string' ? corpo.returnCode : '';
    if (codigo !== CONTRATO_REDE.codigoReferenciaDuplicada.valor) return null;

    const { body } = await this.requestRede<Record<string, unknown>>(
      'GET',
      CONTRATO_REDE.consultarPorReferencia.valor.replace('{reference}', reference),
    );

    return this.deConsulta(body);
  }

  /**
   * Devolve (ou cancela) e CONSULTA em seguida.
   *
   * Dois motivos: a resposta da devolução não traz os valores totais do
   * pagamento — e o código 360 significa "recebido", não "feito". A consulta é
   * a única fonte da verdade; o status do pedido só ajusta a mensagem.
   *
   * O `amount` é OBRIGATÓRIO no cancelamento da Rede — confirmado na
   * verificação contra o sandbox em 2026-07-31: sem corpo, HTTP 400. Quando
   * quem chamou não informa o valor (cancelar reserva, devolver tudo), ele é
   * descoberto pela consulta: o autorizado se nada foi capturado, ou o que
   * resta do capturado.
   */
  private async devolverEConsultar(
    tid: string,
    amountCents: Cents | undefined,
  ): Promise<PaymentResult> {
    let valor = amountCents;

    if (valor === undefined) {
      const atual = await this.getPayment(tid);
      valor = assertCents(
        atual.amountCapturedCents > 0
          ? atual.amountCapturedCents - atual.amountRefundedCents
          : atual.amountAuthorizedCents,
      );
    }

    const { body } = await this.requestRede<Record<string, unknown>>(
      'POST',
      CONTRATO_REDE.cancelar.valor.replace('{tid}', tid),
      { [CONTRATO_REDE.campoValor.valor]: valor },
    );

    const codigo = typeof body?.returnCode === 'string' ? body.returnCode : '';
    const consulta = await this.getPayment(tid);

    if (codigo === CONTRATO_REDE.codigoDevolucaoRecebida.valor) {
      // Assíncrono (D+1): quem chamou precisa reconsultar até Done/Denied.
      return {
        ...consulta,
        message:
          'A devolução foi recebida pela Rede e será processada. ' +
          'O valor só é confirmado na reconsulta.',
        providerCode: codigo,
      };
    }

    return { ...consulta, providerCode: codigo || consulta.providerCode };
  }

  /** Resposta direta de autorização/captura → resultado. */
  private deResposta(body: Record<string, unknown>, valorPedido: number): PaymentResult {
    const codigo = typeof body?.returnCode === 'string' ? body.returnCode : '';
    const aprovado = codigo === CONTRATO_REDE.codigoSucesso.valor;

    const valor =
      typeof body?.amount === 'number' && Number.isInteger(body.amount) ? body.amount : valorPedido;

    return {
      ok: aprovado,
      status: aprovado ? 'AUTHORIZED' : 'DECLINED',
      providerPaymentId: String(body?.tid ?? ''),
      amountAuthorizedCents: aprovado ? valor : 0,
      amountCapturedCents: 0,
      amountRefundedCents: 0,
      instrument: {
        // Só os quatro últimos (campo `last4` da Rede). O número completo não
        // existe em lugar nenhum deste processo.
        cardLastFour: typeof body?.last4 === 'string' ? body.last4 : undefined,
        cardBrand: this.marcaDe(body),
        nsu: typeof body?.nsu === 'string' ? body.nsu : undefined,
        authorizationCode:
          typeof body?.authorizationCode === 'string' ? body.authorizationCode : undefined,
      },
      message: aprovado
        ? 'Valor reservado no cartão.'
        : 'Pagamento recusado pelo emissor do cartão.',
      providerCode: codigo,
      raw: body,
    };
  }

  /** Resposta da CONSULTA → resultado. É a fonte da verdade. */
  private deConsulta(body: Record<string, unknown>): PaymentResult {
    const auth = (body?.authorization ?? {}) as Record<string, unknown>;
    const capture = body?.capture as Record<string, unknown> | undefined;
    const refunds = body?.refunds;

    const bruto = typeof auth.status === 'string' ? auth.status.toUpperCase() : '';
    let status: PaymentStatus = CONTRATO_REDE.mapaDeEstados.valor[bruto] ?? 'FAILED';

    const capturado =
      typeof capture?.amount === 'number' && Number.isInteger(capture.amount) ? capture.amount : 0;

    // Soma apenas as devoluções CONCLUÍDAS — Processing ainda não é dinheiro.
    const devolvidoBruto = (Array.isArray(refunds) ? refunds : refunds ? [refunds] : [])
      .map((r) => r as Record<string, unknown>)
      .filter((r) => typeof r.status === 'string' && r.status.toUpperCase() === 'DONE')
      .reduce((soma, r) => soma + (typeof r.amount === 'number' ? r.amount : 0), 0);

    /**
     * Devolução só existe sobre dinheiro COBRADO. O cancelamento de uma
     * pré-autorização também passa pelo caminho de refunds na Rede, mas nada
     * foi cobrado — registrá-lo como "devolvido" poria no extrato uma
     * devolução de dinheiro que nunca saiu do cartão. Visto na verificação
     * contra o sandbox (2026-07-31, passo 7).
     */
    const devolvido = capturado > 0 ? devolvidoBruto : 0;

    if (status === 'CAPTURED' && capturado === 0) status = 'AUTHORIZED';
    if (status === 'CAPTURED' && devolvido > 0) {
      status = devolvido >= capturado ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    }
    if (status === 'VOIDED' && devolvido > 0) status = 'REFUNDED';

    const autorizado =
      typeof auth.amount === 'number' && Number.isInteger(auth.amount) ? auth.amount : 0;

    return {
      ok: status !== 'DECLINED' && status !== 'FAILED',
      status,
      providerPaymentId: String(auth.tid ?? ''),
      amountAuthorizedCents: autorizado,
      amountCapturedCents: capturado,
      amountRefundedCents: devolvido,
      instrument: {
        cardLastFour: typeof auth.last4 === 'string' ? auth.last4 : undefined,
        nsu: typeof auth.nsu === 'string' ? auth.nsu : undefined,
        authorizationCode:
          typeof auth.authorizationCode === 'string' ? auth.authorizationCode : undefined,
      },
      message: this.mensagemDe(status),
      providerCode: typeof auth.returnCode === 'string' ? auth.returnCode : undefined,
      raw: body,
    };
  }

  private marcaDe(body: Record<string, unknown>): string | undefined {
    const brand = body?.brand as Record<string, unknown> | undefined;
    return typeof brand?.name === 'string' ? brand.name : undefined;
  }

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
        return 'Pagamento em processamento.';
      default:
        return 'Não foi possível concluir o pagamento.';
    }
  }
}
