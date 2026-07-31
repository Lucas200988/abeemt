import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { HttpPaymentProvider, type HttpProviderConfig } from './http-provider';
import { PaymentProviderError } from './provider';

/**
 * Subclasse mínima para exercitar a base.
 *
 * Os métodos são `protected` — expô-los aqui é o preço de testá-los sem rede de
 * verdade, e vale a pena: retentativa, prazo e assinatura são exatamente o que
 * não dá para conferir olhando o código.
 */
class Sonda extends HttpPaymentProvider {
  chamar(metodo: 'GET' | 'POST', caminho: string, opcoes = {}) {
    return this.request(metodo, caminho, opcoes);
  }

  conferirAssinatura(rawBody: Buffer | undefined, assinatura: string | undefined) {
    return this.verificarAssinaturaHmac(rawBody, assinatura);
  }

  limpar(texto: string) {
    return this.redigir(texto);
  }
}

const TOKEN = 'tok_secreto_nao_deve_vazar';

/** Registra as chamadas e devolve as respostas programadas, em ordem. */
function fetchFalso(respostas: (Response | Error)[]) {
  const chamadas: { url: string; init: RequestInit }[] = [];

  const impl = (async (url: string, init: RequestInit) => {
    chamadas.push({ url, init });
    const proxima = respostas.shift();
    if (proxima instanceof Error) throw proxima;
    if (!proxima) throw new Error('sem resposta programada');
    return proxima;
  }) as unknown as typeof fetch;

  return { impl, chamadas };
}

function resposta(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), { status });
}

function criar(config: Partial<HttpProviderConfig> & { fetchImpl: typeof fetch }) {
  return new Sonda({
    baseUrl: 'https://adquirente.exemplo/v1',
    token: TOKEN,
    // Sem espera real: o teste mede a lógica, não o relógio.
    sleepImpl: async () => undefined,
    ...config,
  });
}

// ===========================================================================

describe('configuração', () => {
  it('exige baseUrl e token', () => {
    expect(() => new Sonda({ baseUrl: '', token: 'x' })).toThrow(/baseUrl/);
    expect(() => new Sonda({ baseUrl: 'https://x', token: '' })).toThrow(/token/);
  });

  it('normaliza a barra final da baseUrl', async () => {
    const { impl, chamadas } = fetchFalso([resposta(200)]);
    await criar({ fetchImpl: impl, baseUrl: 'https://adquirente.exemplo/v1/' }).chamar(
      'GET',
      '/charges',
    );

    // Sem a normalização sairia ".../v1//charges", que alguns servidores
    // tratam como rota diferente.
    expect(chamadas[0].url).toBe('https://adquirente.exemplo/v1/charges');
  });
});

describe('retentativa', () => {
  it('tenta de novo em erro de rede e devolve o sucesso seguinte', async () => {
    const { impl, chamadas } = fetchFalso([new Error('ECONNRESET'), resposta(200, { ok: true })]);

    const r = await criar({ fetchImpl: impl }).chamar('POST', '/charges');

    expect(chamadas).toHaveLength(2);
    expect(r.body).toEqual({ ok: true });
  });

  it('tenta de novo em 500 e em 429', async () => {
    const { impl, chamadas } = fetchFalso([resposta(500), resposta(429), resposta(200)]);

    await criar({ fetchImpl: impl }).chamar('POST', '/charges');

    expect(chamadas).toHaveLength(3);
  });

  /**
   * A regra que mais importa. Repetir uma recusa não muda o resultado, pode
   * disparar antifraude e é assim que se cria cobrança duplicada.
   */
  it('NÃO tenta de novo em 4xx', async () => {
    const { impl, chamadas } = fetchFalso([resposta(422, { erro: 'valor acima do autorizado' })]);

    await expect(criar({ fetchImpl: impl }).chamar('POST', '/capture')).rejects.toMatchObject({
      code: 'HTTP_422',
      retryable: false,
    });

    expect(chamadas).toHaveLength(1);
  });

  it('desiste depois do número configurado de tentativas', async () => {
    const { impl, chamadas } = fetchFalso([resposta(500), resposta(500), resposta(500)]);

    await expect(
      criar({ fetchImpl: impl, maxRetries: 2 }).chamar('GET', '/charges'),
    ).rejects.toBeInstanceOf(PaymentProviderError);

    // A primeira mais duas retentativas.
    expect(chamadas).toHaveLength(3);
  });

  it('espera mais a cada tentativa', async () => {
    const esperas: number[] = [];
    const { impl } = fetchFalso([resposta(500), resposta(500), resposta(200)]);

    await criar({
      fetchImpl: impl,
      retryBaseMs: 100,
      sleepImpl: async (ms) => {
        esperas.push(ms);
      },
    }).chamar('GET', '/charges');

    expect(esperas).toEqual([100, 200]);
  });
});

describe('prazo', () => {
  it('aborta e marca como recuperável', async () => {
    // Um fetch que nunca responde, mas respeita o sinal de aborto.
    const impl = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const erro = new Error('abortado');
          erro.name = 'AbortError';
          reject(erro);
        });
      })) as unknown as typeof fetch;

    await expect(
      criar({ fetchImpl: impl, timeoutMs: 20, maxRetries: 0 }).chamar('GET', '/charges'),
    ).rejects.toMatchObject({ code: 'TIMEOUT', retryable: true });
  });
});

describe('cabeçalhos', () => {
  it('envia a credencial e a chave de idempotência', async () => {
    const { impl, chamadas } = fetchFalso([resposta(200)]);

    await criar({ fetchImpl: impl }).chamar('POST', '/charges', {
      body: { valor: 100 },
      idempotencyKey: 'chave-123',
    });

    const headers = chamadas[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers['x-idempotency-key']).toBe('chave-123');
    expect(chamadas[0].init.body).toBe('{"valor":100}');
  });

  it('não envia chave de idempotência quando não há', async () => {
    const { impl, chamadas } = fetchFalso([resposta(200)]);
    await criar({ fetchImpl: impl }).chamar('GET', '/charges');

    expect(chamadas[0].init.headers).not.toHaveProperty('x-idempotency-key');
  });
});

describe('assinatura do webhook', () => {
  const segredo = 'segredo-do-webhook';
  const corpo = Buffer.from('{"id":"evt_1","status":"CAPTURED"}');
  const assinatura = createHmac('sha256', segredo).update(corpo).digest('hex');

  const comSegredo = () => criar({ fetchImpl: fetchFalso([]).impl, webhookSecret: segredo });

  it('aceita assinatura correta', () => {
    expect(comSegredo().conferirAssinatura(corpo, assinatura)).toBe(true);
  });

  it('aceita em maiúsculas e com espaços', () => {
    expect(comSegredo().conferirAssinatura(corpo, ` ${assinatura.toUpperCase()} `)).toBe(true);
  });

  it('recusa assinatura errada', () => {
    expect(comSegredo().conferirAssinatura(corpo, 'a'.repeat(64))).toBe(false);
  });

  /** O ponto da assinatura: detectar corpo adulterado no caminho. */
  it('recusa quando o corpo muda um único byte', () => {
    const adulterado = Buffer.from('{"id":"evt_1","status":"CAPTUREE"}');
    expect(comSegredo().conferirAssinatura(adulterado, assinatura)).toBe(false);
  });

  it('recusa assinatura de tamanho diferente', () => {
    expect(comSegredo().conferirAssinatura(corpo, 'curta')).toBe(false);
  });

  it('recusa quando falta o corpo cru', () => {
    expect(comSegredo().conferirAssinatura(undefined, assinatura)).toBe(false);
  });

  /**
   * Sem segredo configurado, recusa tudo. Aceitar transformaria um
   * esquecimento de configuração em endpoint aberto — qualquer um confirmaria
   * pagamentos.
   */
  it('recusa tudo quando não há segredo configurado', () => {
    const semSegredo = criar({ fetchImpl: fetchFalso([]).impl });
    expect(semSegredo.conferirAssinatura(corpo, assinatura)).toBe(false);
  });
});

describe('redação de credencial', () => {
  it('remove o token de qualquer texto', () => {
    const p = criar({ fetchImpl: fetchFalso([]).impl });
    expect(p.limpar(`falhou ao chamar com Bearer ${TOKEN}`)).toBe(
      'falhou ao chamar com Bearer [REDIGIDO]',
    );
  });

  /**
   * Bibliotecas de HTTP costumam incluir URL e cabeçalhos na mensagem de erro.
   * Sem a limpeza, o token iria para o log (risco R-15).
   */
  it('o token não aparece na mensagem de erro de rede', async () => {
    const { impl } = fetchFalso([new Error(`falha ao conectar usando ${TOKEN}`)]);

    try {
      await criar({ fetchImpl: impl, maxRetries: 0 }).chamar('GET', '/charges');
      expect.unreachable('deveria ter lançado');
    } catch (e) {
      expect((e as Error).message).not.toContain(TOKEN);
      expect((e as Error).message).toContain('[REDIGIDO]');
    }
  });
});

describe('resposta não-JSON', () => {
  it('não engole o corpo de uma página de erro de proxy', async () => {
    const impl = (async () =>
      new Response('<html>502 Bad Gateway</html>', { status: 502 })) as unknown as typeof fetch;

    try {
      await criar({ fetchImpl: impl, maxRetries: 0 }).chamar('GET', '/charges');
      expect.unreachable('deveria ter lançado');
    } catch (e) {
      expect((e as PaymentProviderError).raw).toMatchObject({
        raw: expect.stringContaining('502'),
      });
    }
  });
});
