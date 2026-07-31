import { createHmac, timingSafeEqual } from 'node:crypto';
import { PaymentProviderError } from './provider';

/**
 * Base para adapters que falam HTTP com um adquirente.
 *
 * Reúne o que é igual em **qualquer** fornecedor — e que, se ficasse a cargo de
 * cada adapter, seria reimplementado com sutilezas diferentes em cada um:
 *
 *  * prazo máximo de espera, para uma chamada travada não segurar a recarga;
 *  * retentativa **só** no que é recuperável — repetir uma recusa do emissor
 *    não muda o resultado e ainda pode disparar antifraude;
 *  * chave de idempotência propagada, para retentativa não virar cobrança dupla;
 *  * verificação de assinatura de webhook sobre os **bytes originais**;
 *  * credencial jamais em log.
 *
 * O que sobra para o adapter concreto é o que de fato muda entre fornecedores:
 * caminhos, nomes de campos e códigos de erro.
 */

export interface HttpProviderConfig {
  /** Raiz da API do adquirente, sem barra no fim. */
  baseUrl: string;
  /** Credencial. Nunca vai para log, nem em erro (ver `redigir`). */
  token: string;
  /** Segredo da assinatura de webhook. Sem ele, `verifyWebhook` sempre recusa. */
  webhookSecret?: string;
  /** Prazo de cada tentativa. Padrão: 20 s. */
  timeoutMs?: number;
  /** Tentativas ADICIONAIS após a primeira falha recuperável. Padrão: 2. */
  maxRetries?: number;
  /** Espera inicial do backoff, dobrada a cada tentativa. Padrão: 300 ms. */
  retryBaseMs?: number;
  /**
   * Injetáveis para teste. Sem eles, nenhum destes comportamentos seria
   * verificável sem rede de verdade — e um adapter de pagamento não testado é
   * exatamente o que a regra 18.20 do briefing proíbe levar adiante.
   */
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
}

export interface HttpResposta<T = unknown> {
  status: number;
  body: T;
}

const PADROES = {
  timeoutMs: 20_000,
  maxRetries: 2,
  retryBaseMs: 300,
};

export abstract class HttpPaymentProvider {
  protected readonly config: Required<
    Omit<HttpProviderConfig, 'webhookSecret' | 'fetchImpl' | 'sleepImpl'>
  > & {
    webhookSecret?: string;
    fetchImpl: typeof fetch;
    sleepImpl: (ms: number) => Promise<void>;
  };

  constructor(config: HttpProviderConfig) {
    if (!config.baseUrl) throw new Error('baseUrl é obrigatória');
    if (!config.token) throw new Error('token é obrigatório');

    this.config = {
      baseUrl: config.baseUrl.replace(/\/+$/, ''),
      token: config.token,
      webhookSecret: config.webhookSecret,
      timeoutMs: config.timeoutMs ?? PADROES.timeoutMs,
      maxRetries: config.maxRetries ?? PADROES.maxRetries,
      retryBaseMs: config.retryBaseMs ?? PADROES.retryBaseMs,
      fetchImpl: config.fetchImpl ?? globalThis.fetch,
      sleepImpl: config.sleepImpl ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    };
  }

  /**
   * Chamada HTTP com prazo, retentativa e idempotência.
   *
   * A regra de retentativa é a parte que mais importa e a mais fácil de errar:
   *
   *  * erro de rede e 5xx → tenta de novo, o adquirente pode voltar;
   *  * 429 → tenta de novo, é limite de taxa;
   *  * **qualquer outro 4xx → NÃO tenta**. Cartão recusado, valor acima do
   *    autorizado ou dado inválido não mudam por insistência, e repetir
   *    pagamento é como se cria cobrança duplicada.
   */
  protected async request<T = unknown>(
    metodo: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    caminho: string,
    opcoes: { body?: unknown; idempotencyKey?: string; headers?: Record<string, string> } = {},
  ): Promise<HttpResposta<T>> {
    const url = `${this.config.baseUrl}${caminho.startsWith('/') ? caminho : `/${caminho}`}`;

    let ultimoErro: PaymentProviderError | null = null;

    for (let tentativa = 0; tentativa <= this.config.maxRetries; tentativa += 1) {
      if (tentativa > 0) {
        await this.config.sleepImpl(this.config.retryBaseMs * 2 ** (tentativa - 1));
      }

      try {
        return await this.tentar<T>(metodo, url, opcoes);
      } catch (error) {
        const falha =
          error instanceof PaymentProviderError
            ? error
            : new PaymentProviderError(
                this.redigir(error instanceof Error ? error.message : String(error)),
                'NETWORK',
                true,
              );

        if (!falha.retryable) throw falha;
        ultimoErro = falha;
      }
    }

    throw (
      ultimoErro ??
      new PaymentProviderError('falha desconhecida na chamada ao adquirente', 'UNKNOWN', true)
    );
  }

  private async tentar<T>(
    metodo: string,
    url: string,
    opcoes: { body?: unknown; idempotencyKey?: string; headers?: Record<string, string> },
  ): Promise<HttpResposta<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const resposta = await this.config.fetchImpl(url, {
        method: metodo,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${this.config.token}`,
          // Repetir a mesma chave não pode gerar dois pagamentos — a proteção
          // vale tanto do nosso lado (índice único) quanto do lado deles.
          ...(opcoes.idempotencyKey ? { 'x-idempotency-key': opcoes.idempotencyKey } : {}),
          ...opcoes.headers,
        },
        body: opcoes.body === undefined ? undefined : JSON.stringify(opcoes.body),
      });

      const texto = await resposta.text();
      const body = texto ? (this.parseJson(texto) as T) : (null as T);

      if (resposta.ok) return { status: resposta.status, body };

      const recuperavel = resposta.status >= 500 || resposta.status === 429;

      throw new PaymentProviderError(
        `adquirente respondeu ${resposta.status}`,
        recuperavel ? 'PROVIDER_UNAVAILABLE' : `HTTP_${resposta.status}`,
        recuperavel,
        body,
      );
    } catch (error) {
      if (error instanceof PaymentProviderError) throw error;

      // `AbortError` é o nosso próprio prazo estourando. Recuperável: a chamada
      // pode ter chegado, e é justamente para esse caso que existe a chave de
      // idempotência.
      const abortou = error instanceof Error && error.name === 'AbortError';

      throw new PaymentProviderError(
        abortou
          ? `o adquirente não respondeu em ${this.config.timeoutMs} ms`
          : this.redigir(error instanceof Error ? error.message : String(error)),
        abortou ? 'TIMEOUT' : 'NETWORK',
        true,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Confere a assinatura HMAC-SHA256 do webhook.
   *
   * Três cuidados, cada um por um motivo concreto:
   *
   *  1. **Sobre os bytes originais.** Reconverter o JSON muda espaçamento e
   *     ordem de chaves; a assinatura deixaria de bater sempre.
   *  2. **Comparação em tempo constante.** Comparar com `===` vaza, pelo tempo
   *     de resposta, quantos caracteres iniciais estão certos — dá para
   *     descobrir a assinatura byte a byte.
   *  3. **Sem segredo, recusa.** Aceitar tudo quando falta configuração
   *     transformaria um esquecimento em endpoint aberto.
   */
  protected verificarAssinaturaHmac(
    rawBody: Buffer | undefined,
    assinaturaRecebida: string | undefined,
  ): boolean {
    if (!this.config.webhookSecret) return false;
    if (!rawBody || !assinaturaRecebida) return false;

    const esperada = createHmac('sha256', this.config.webhookSecret).update(rawBody).digest('hex');

    const a = Buffer.from(esperada, 'utf8');
    const b = Buffer.from(assinaturaRecebida.trim().toLowerCase(), 'utf8');

    // `timingSafeEqual` exige tamanhos iguais; comprimento diferente já é recusa.
    if (a.length !== b.length) return false;

    return timingSafeEqual(a, b);
  }

  /**
   * Remove a credencial de qualquer texto antes de virar log ou mensagem.
   *
   * Bibliotecas de HTTP costumam incluir a URL e os cabeçalhos na mensagem de
   * erro. Sem esta limpeza, um erro de rede publicaria o token no log
   * (briefing seção 12, risco R-15).
   */
  protected redigir(texto: string): string {
    if (!this.config.token) return texto;
    return texto.split(this.config.token).join('[REDIGIDO]');
  }

  private parseJson(texto: string): unknown {
    try {
      return JSON.parse(texto);
    } catch {
      // Resposta que não é JSON costuma ser página de erro de proxy. O corpo
      // cru ajuda a diagnosticar e não deve ser engolido.
      return { raw: texto.slice(0, 500) };
    }
  }
}
