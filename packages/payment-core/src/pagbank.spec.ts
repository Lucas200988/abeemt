import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assertCents } from '@bora/contracts';
import {
  CARTOES_DE_TESTE_SANDBOX,
  CONTRATO,
  PagBankProvider,
  pendenciasDoContrato,
} from './pagbank';
import { assertProviderSupportsModel } from './provider';

/**
 * O que estes testes provam — e o que NÃO provam.
 *
 * Provam: a trava funciona, o mapeamento de estados é conservador, a assinatura
 * do webhook é conferida sobre os bytes originais, e nenhum dado proibido é
 * guardado.
 *
 * **Não provam** que o adapter fala com o PagBank. Isso só a suíte de
 * conformidade contra o sandbox pode dizer, e ela depende de credenciais que
 * ainda não temos. Testar contra respostas que eu mesmo inventei confirmaria
 * apenas que sei repetir a minha suposição.
 */

const base = {
  baseUrl: 'https://sandbox.exemplo/v1',
  token: 'tok_de_teste',
  fetchImpl: (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch,
};

const criar = (extra: Record<string, unknown> = {}) => new PagBankProvider({ ...base, ...extra });

describe('trava de verificação', () => {
  /**
   * A garantia mais importante deste arquivo. Um adapter cujo contrato não foi
   * conferido, operando em produção, é como se descobre a divergência com
   * dinheiro de motorista.
   */
  it('recusa qualquer operação enquanto não for verificado', async () => {
    const p = criar();

    await expect(
      p.authorize({ amountCents: assertCents(1000), method: 'CREDIT_CARD', idempotencyKey: 'k' }),
    ).rejects.toMatchObject({ code: 'ADAPTER_NOT_VERIFIED' });

    await expect(p.capture('c1', assertCents(500))).rejects.toMatchObject({
      code: 'ADAPTER_NOT_VERIFIED',
    });
    await expect(p.voidPayment('c1')).rejects.toMatchObject({ code: 'ADAPTER_NOT_VERIFIED' });
    await expect(p.refund('c1')).rejects.toMatchObject({ code: 'ADAPTER_NOT_VERIFIED' });
    await expect(p.getPayment('c1')).rejects.toMatchObject({ code: 'ADAPTER_NOT_VERIFIED' });
  });

  it('a mensagem diz o que falta e onde olhar', async () => {
    try {
      await criar().getPayment('c1');
      expect.unreachable('deveria ter lançado');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('não foi verificado');
      expect(msg).toContain('fase-7-o-que-falta.md');
      // Contrato lido inteiro: a mensagem aponta o passo que falta.
      expect(msg).toContain('verificar:pagbank');
    }
  });

  /**
   * O contrato inteiro foi lido na documentação oficial (2026-08-03, trazida
   * por Lucas): endpoints, campos, estados, assinatura e cartões de teste.
   *
   * Isso NÃO abre a trava. Na Rede o contrato também estava "fechado" no papel
   * e a verificação no sandbox achou três erros reais. `verificado` só vira
   * verdade depois do `pnpm verificar:pagbank` aprovar.
   */
  it('não resta pendência de leitura no contrato', () => {
    expect(pendenciasDoContrato()).toEqual([]);
  });

  it('o que já é sabido está marcado como confirmado', () => {
    // Pré-autorização por `capture: false` é o item que sustenta o ADR-0008
    // neste fornecedor, e veio de material público do PagBank.
    expect(CONTRATO.campoPreAutorizacao.procedencia).toBe('confirmado');
    expect(CONTRATO.campoPreAutorizacao.valor).toBe('capture');
    expect(CONTRATO.campoPrazoCaptura.valor).toBe('capture_before');

    // Lidos nas definições OpenAPI do portal oficial em 2026-08-03.
    expect(CONTRATO.criarChavePublica.procedencia).toBe('confirmado');
    expect(CONTRATO.consultarChavePublica.valor).toBe('/public-keys/card');
    expect(CONTRATO.cabecalhoAutorizacao.valor).toContain('Bearer');

    // Lidos no Objeto Charge, Objeto Order e Webhooks em 2026-08-03.
    expect(CONTRATO.criarPedido.procedencia).toBe('confirmado');
    expect(CONTRATO.cancelar.procedencia).toBe('confirmado');
    expect(CONTRATO.campoValor.procedencia).toBe('confirmado');
    expect(CONTRATO.mapaDeEstados.procedencia).toBe('confirmado');
    expect(CONTRATO.cabecalhoAssinatura.procedencia).toBe('confirmado');
    expect(CONTRATO.preAutorizacaoSoCredito.valor).toBe(true);

    // Lidos na definição OpenAPI de Criar Pedido em 2026-08-03.
    expect(CONTRATO.campoCartaoCriptografado.procedencia).toBe('confirmado');
    expect(CONTRATO.campoCartaoCriptografado.valor).toBe('payment_method.card.encrypted');
    expect(CONTRATO.cabecalhoIdempotencia.valor).toBe('x-idempotency-key');
    expect(CONTRATO.clienteDocumentoObrigatorio.procedencia).toBe('confirmado');
  });

  /**
   * O mapa cobre exatamente os seis estados documentados. Estado inventado no
   * mapa é tão perigoso quanto estado faltando: os dois escondem o dia em que
   * o fornecedor muda o contrato.
   */
  it('o mapa de estados tem exatamente os seis estados documentados', () => {
    expect(Object.keys(CONTRATO.mapaDeEstados.valor).sort()).toEqual([
      'AUTHORIZED',
      'CANCELED',
      'DECLINED',
      'IN_ANALYSIS',
      'PAID',
      'WAITING',
    ]);
  });
});

/**
 * A garantia da seção 12 neste fornecedor.
 *
 * O PagBank aceita o cartão em claro; o adapter não. A única entrada é o blob
 * criptografado no cliente com a chave pública. Se algum dia alguém abrir uma
 * porta para o número completo, este teste cai antes de o código subir.
 */
describe('o número do cartão não tem entrada', () => {
  const verificado = () => criar({ verificado: true });

  /**
   * Não é escolha nossa: o Objeto Charge documenta `capture: false` como
   * indisponível para débito. Aceitar débito aqui produziria cobrança direta
   * onde o sistema espera reserva — dinheiro cobrado sem energia entregue.
   */
  it('recusa débito — pré-autorização só existe no crédito', async () => {
    await expect(
      verificado().authorize({
        amountCents: assertCents(20000),
        method: 'DEBIT_CARD',
        idempotencyKey: 'k',
        metadata: { encryptedCard: 'blob' },
      }),
    ).rejects.toMatchObject({ code: 'METHOD_NOT_SUPPORTED' });
  });

  it('recusa autorizar sem o cartão criptografado', async () => {
    await expect(
      verificado().authorize({
        amountCents: assertCents(20000),
        method: 'CREDIT_CARD',
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ code: 'MISSING_CARD_TOKEN' });
  });

  it('a recusa explica o caminho certo', async () => {
    try {
      await verificado().authorize({
        amountCents: assertCents(20000),
        method: 'CREDIT_CARD',
        idempotencyKey: 'k',
        metadata: { cardNumber: '4111111111111111' },
      });
      expect.unreachable('deveria ter lançado');
    } catch (e) {
      expect((e as Error).message).toContain('metadata.encryptedCard');
      expect((e as Error).message).toContain('seção 12');
    }
  });

  it('o cartão criptografado vai no corpo, e o número nunca aparece', async () => {
    let enviado = '';
    const p = criar({
      verificado: true,
      fetchImpl: (async (_url: string, init: RequestInit) => {
        enviado = String(init.body ?? '');
        return new Response(JSON.stringify({ charges: [{ id: 'chg_1', status: 'AUTHORIZED' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as unknown as typeof fetch,
    });

    const r = await p.authorize({
      amountCents: assertCents(20000),
      method: 'CREDIT_CARD',
      idempotencyKey: 'k',
      metadata: {
        encryptedCard: 'blob-cifrado',
        customerTaxId: '12345678909',
        holderName: 'Jose da Silva',
        customerEmail: 'teste@sonare.com.br',
      },
    });

    expect(r.status).toBe('AUTHORIZED');
    expect(enviado).toContain('blob-cifrado');
    expect(enviado).not.toContain('4111');

    const pedido = JSON.parse(enviado);
    // customer.tax_id é obrigatório no Criar Pedido.
    expect(pedido.customer.tax_id).toBe('12345678909');
    // customer.email e items: "opcionais" na documentação, exigidos pelo
    // sandbox (40001) — as duas descobertas da verificação de 2026-08-03.
    expect(pedido.customer.email).toBe('teste@sonare.com.br');
    expect(pedido.items).toEqual([
      { reference_id: 'k', name: 'Recarga de veículo elétrico', quantity: 1, unit_amount: 20000 },
    ]);

    const metodo = pedido.charges[0].payment_method;
    // Reserva, não cobrança.
    expect(metodo.capture).toBe(false);
    // Obrigatório no crédito; recarga não parcela.
    expect(metodo.installments).toBe(1);
    // Nome na fatura limitado aos 22 caracteres do contrato.
    expect(metodo.soft_descriptor.length).toBeLessThanOrEqual(22);
    // Obrigatório com cartão criptografado.
    expect(metodo.card.holder.name).toBe('Jose da Silva');
  });

  /**
   * `customer.tax_id` é obrigatório no Criar Pedido — consequência de produto:
   * no caminho online o motorista informa CPF. Cobrar isso na porta evita o
   * 400 do fornecedor com o motorista esperando na tela.
   */
  it('recusa autorizar sem o CPF do comprador ou sem o nome do portador', async () => {
    const base = {
      amountCents: assertCents(20000),
      method: 'CREDIT_CARD' as const,
      idempotencyKey: 'k',
    };

    await expect(
      verificado().authorize({ ...base, metadata: { encryptedCard: 'blob' } }),
    ).rejects.toMatchObject({ code: 'MISSING_CUSTOMER_TAX_ID' });

    await expect(
      verificado().authorize({
        ...base,
        metadata: { encryptedCard: 'blob', customerTaxId: 'nao-e-cpf' },
      }),
    ).rejects.toMatchObject({ code: 'MISSING_CUSTOMER_TAX_ID' });

    await expect(
      verificado().authorize({
        ...base,
        metadata: { encryptedCard: 'blob', customerTaxId: '12345678909' },
      }),
    ).rejects.toMatchObject({ code: 'MISSING_HOLDER_NAME' });

    // O sandbox exige e-mail apesar de a documentação dizer opcional (40001).
    await expect(
      verificado().authorize({
        ...base,
        metadata: { encryptedCard: 'blob', customerTaxId: '12345678909', holderName: 'Jose' },
      }),
    ).rejects.toMatchObject({ code: 'MISSING_CUSTOMER_EMAIL' });
  });
});

describe('captura e devolução — os caminhos de dinheiro', () => {
  const respostaJson = (corpo: unknown) =>
    new Response(JSON.stringify(corpo), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  /** A resposta oficial da captura parcial: reservou 1000, capturou 500. */
  const capturaParcial = {
    id: 'CHAR_1',
    status: 'PAID',
    amount: { value: 1000, currency: 'BRL', summary: { total: 1000, paid: 500, refunded: 0 } },
    payment_response: { code: '20000', message: 'SUCESSO' },
  };

  it('captura parcial: cobra 500 de uma reserva de 1000 — o E2 em código', async () => {
    let caminho = '';
    let enviado = '';
    const p = criar({
      verificado: true,
      fetchImpl: (async (url: string, init: RequestInit) => {
        caminho = url;
        enviado = String(init.body ?? '');
        return respostaJson(capturaParcial);
      }) as unknown as typeof fetch,
    });

    const r = await p.capture('CHAR_1', assertCents(500));

    expect(caminho).toContain('/charges/CHAR_1/capture');
    expect(JSON.parse(enviado)).toEqual({ amount: { value: 500 } });
    expect(r.status).toBe('CAPTURED');
    expect(r.amountAuthorizedCents).toBe(1000);
    expect(r.amountCapturedCents).toBe(500);
    expect(r.providerCode).toBe('20000');
  });

  /**
   * Devolução sem valor descobre o quanto devolver na consulta — a mesma
   * solução que a verificação da Rede exigiu na rodada 1 (cancelamento sem
   * amount tomava 400).
   */
  it('devolução sem valor consulta antes e devolve o restante', async () => {
    const chamadas: Array<{ metodo: string; url: string; corpo: string }> = [];
    const p = criar({
      verificado: true,
      fetchImpl: (async (url: string, init: RequestInit) => {
        chamadas.push({ metodo: init.method ?? 'GET', url, corpo: String(init.body ?? '') });
        if ((init.method ?? 'GET') === 'GET') {
          return respostaJson({
            id: 'CHAR_1',
            status: 'PAID',
            amount: { value: 1000, summary: { total: 1000, paid: 800, refunded: 300 } },
          });
        }
        return respostaJson({
          id: 'CHAR_1',
          status: 'CANCELED',
          amount: { value: 1000, summary: { total: 1000, paid: 800, refunded: 800 } },
        });
      }) as unknown as typeof fetch,
    });

    const r = await p.refund('CHAR_1');

    expect(chamadas[0].metodo).toBe('GET');
    expect(chamadas[1].metodo).toBe('POST');
    expect(chamadas[1].url).toContain('/charges/CHAR_1/cancel');
    // Devolve o que sobrou: 800 capturados − 300 já devolvidos.
    expect(JSON.parse(chamadas[1].corpo)).toEqual({ amount: { value: 500 } });
    // E o resultado é devolução, não "reserva cancelada".
    expect(r.status).toBe('REFUNDED');
  });

  it('devolução de cobrança já zerada é erro claro, não 400 do fornecedor', async () => {
    const p = criar({
      verificado: true,
      fetchImpl: (async () =>
        respostaJson({
          id: 'CHAR_1',
          status: 'CANCELED',
          amount: { value: 1000, summary: { total: 1000, paid: 800, refunded: 800 } },
        })) as unknown as typeof fetch,
    });

    await expect(p.refund('CHAR_1')).rejects.toMatchObject({ code: 'NOTHING_TO_REFUND' });
  });

  it('cancelar reserva envia o valor autorizado no corpo', async () => {
    const chamadas: Array<{ metodo: string; corpo: string }> = [];
    const p = criar({
      verificado: true,
      fetchImpl: (async (url: string, init: RequestInit) => {
        chamadas.push({ metodo: init.method ?? 'GET', corpo: String(init.body ?? '') });
        if ((init.method ?? 'GET') === 'GET') {
          return respostaJson({
            id: 'CHAR_1',
            status: 'AUTHORIZED',
            amount: { value: 20000, summary: { total: 20000, paid: 0, refunded: 0 } },
          });
        }
        return respostaJson({
          id: 'CHAR_1',
          status: 'CANCELED',
          amount: { value: 20000, summary: { total: 20000, paid: 0, refunded: 0 } },
        });
      }) as unknown as typeof fetch,
    });

    const r = await p.voidPayment('CHAR_1');

    expect(JSON.parse(chamadas[1].corpo)).toEqual({ amount: { value: 20000 } });
    // Sem captura, CANCELED é cancelamento de reserva mesmo.
    expect(r.status).toBe('VOIDED');
  });
});

describe('chave pública', () => {
  /**
   * Vale sem a trava: o caminho está confirmado no portal e é a primeira
   * chamada a fazer quando as credenciais chegarem.
   */
  it('é buscada mesmo com o adapter ainda não verificado', async () => {
    let caminho = '';
    const p = criar({
      fetchImpl: (async (url: string) => {
        caminho = url;
        return new Response(JSON.stringify({ public_key: 'MIIBIjANB...', created_at: 1 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as unknown as typeof fetch,
    });

    expect(p.verificado).toBe(false);
    expect(await p.chavePublicaDeCartao()).toBe('MIIBIjANB...');
    expect(caminho).toContain('/public-keys/card');
  });

  it('resposta sem chave é erro, não string vazia', async () => {
    const p = criar({
      fetchImpl: (async () =>
        new Response('{}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as unknown as typeof fetch,
    });

    await expect(p.chavePublicaDeCartao()).rejects.toMatchObject({ code: 'MALFORMED' });
  });
});

describe('cartões de teste do sandbox', () => {
  it('cobrem as bandeiras que o motorista vai apresentar', () => {
    const bandeiras = CARTOES_DE_TESTE_SANDBOX.aprovados.map((c) => c.bandeira);
    expect(bandeiras).toContain('visa');
    expect(bandeiras).toContain('mastercard');
    expect(bandeiras).toContain('elo');
  });

  /**
   * A recusa tem que ser provocável. Na verificação da Rede, o passo que
   * achou erro real foi justamente o da recusa — e lá o cartão de recusa teve
   * que ser descoberto na tentativa e erro. Aqui já temos a tabela.
   */
  it('há um cartão de recusa para cada bandeira aprovada', () => {
    const aprovadas = CARTOES_DE_TESTE_SANDBOX.aprovados.map((c) => c.bandeira).sort();
    const recusadas = CARTOES_DE_TESTE_SANDBOX.recusados.map((c) => c.bandeira).sort();
    expect(recusadas).toEqual(aprovadas);
  });

  it('nenhum número aparece nas duas listas', () => {
    const aprovados = new Set(CARTOES_DE_TESTE_SANDBOX.aprovados.map((c) => c.numero));
    for (const c of CARTOES_DE_TESTE_SANDBOX.recusados) {
      expect(aprovados.has(c.numero)).toBe(false);
    }
  });
});

describe('capacidades', () => {
  it('atende o modelo do produto', () => {
    expect(() => assertProviderSupportsModel(criar())).not.toThrow();
  });

  it('não oferece Pix enquanto o fluxo não for confirmado', () => {
    // Declarar um meio que o adapter não sabe executar faria o painel oferecer
    // ao motorista algo que falharia na hora do pagamento.
    expect(criar().capabilities.methods).not.toContain('PIX');
  });

  it('avisa que a reserva expira, para o alerta do risco R-23', () => {
    expect(criar().capabilities.authorizationValidityDays).toBe(6);
  });
});

describe('assinatura do webhook — a fórmula do PagBank, não HMAC', () => {
  const segredo = 'segredo';
  const corpo = Buffer.from('{"id":"evt_1","charges":[{"id":"chg_1","status":"PAID"}]}');
  // A fórmula oficial: sha256("{token}-{payload}") em hex.
  const assinar = (token: string, body: Buffer) =>
    createHash('sha256')
      .update(Buffer.concat([Buffer.from(`${token}-`), body]))
      .digest('hex');

  it('aceita a assinatura oficial no cabeçalho do fornecedor', async () => {
    const p = criar({ webhookSecret: segredo });
    const headers = { [CONTRATO.cabecalhoAssinatura.valor]: assinar(segredo, corpo) };

    expect(await p.verifyWebhook({}, headers, corpo)).toBe(true);
  });

  /**
   * A regressão que a documentação oficial expôs: a versão anterior deste
   * adapter validava HMAC-SHA256, que NÃO é a fórmula do PagBank. Todo webhook
   * legítimo seria recusado em silêncio.
   */
  it('recusa a assinatura HMAC — a fórmula antiga estava errada', async () => {
    const p = criar({ webhookSecret: segredo });
    const hmac = createHmac('sha256', segredo).update(corpo).digest('hex');

    expect(await p.verifyWebhook({}, { [CONTRATO.cabecalhoAssinatura.valor]: hmac }, corpo)).toBe(
      false,
    );
  });

  it('recusa corpo adulterado', async () => {
    const p = criar({ webhookSecret: segredo });
    const adulterado = Buffer.from(
      '{"id":"evt_1","charges":[{"id":"chg_1","status":"PAID","x":1}]}',
    );

    expect(
      await p.verifyWebhook(
        {},
        { [CONTRATO.cabecalhoAssinatura.valor]: assinar(segredo, corpo) },
        adulterado,
      ),
    ).toBe(false);
  });

  /**
   * O segredo da assinatura é o token da conta. Sem `webhookSecret` explícito,
   * o adapter usa o próprio token de API — que é o comportamento documentado.
   */
  it('sem webhookSecret, o token da conta assina', async () => {
    const p = criar(); // token: 'tok_de_teste'
    const headers = { [CONTRATO.cabecalhoAssinatura.valor]: assinar('tok_de_teste', corpo) };

    expect(await p.verifyWebhook({}, headers, corpo)).toBe(true);
  });

  /**
   * A verificação de assinatura funciona mesmo sem o adapter estar verificado:
   * é criptografia, não depende da trava. Bloqueá-la só atrapalharia o dia
   * de ligar o sandbox.
   */
  it('funciona sem depender da trava', async () => {
    const p = criar({ webhookSecret: segredo });
    expect(p.verificado).toBe(false);
    expect(
      await p.verifyWebhook(
        {},
        { [CONTRATO.cabecalhoAssinatura.valor]: assinar(segredo, corpo) },
        corpo,
      ),
    ).toBe(true);
  });
});

describe('leitura do evento', () => {
  it('extrai identificadores e estado do formato do webhook oficial', async () => {
    // Estrutura do exemplo publicado: o webhook é o pedido inteiro, com o
    // summary DENTRO de amount.
    const evento = await criar().parseWebhook({
      id: 'ORDE_F87334AC',
      charges: [
        {
          id: 'CHAR_F1F10115',
          status: 'PAID',
          amount: { value: 2800, currency: 'BRL', summary: { total: 2800, paid: 2800 } },
        },
      ],
    });

    expect(evento.eventId).toBe('ORDE_F87334AC');
    expect(evento.providerPaymentId).toBe('CHAR_F1F10115');
    expect(evento.status).toBe('CAPTURED');
    expect(evento.amountCents).toBe(2800);
  });

  /**
   * Devolução não é estado no PagBank: a cobrança devolvida continua PAID, com
   * o valor em amount.summary.refunded. Sem esta derivação, o painel mostraria
   * "cobrado" para um motorista já ressarcido.
   */
  it('PAID com summary.refunded vira devolução, não cobrança', async () => {
    const base = { id: 'ORDE_1' };
    const cobranca = (paid: number, refunded: number) => ({
      ...base,
      charges: [
        {
          id: 'CHAR_1',
          status: 'PAID',
          amount: { value: paid, summary: { total: paid, paid, refunded } },
        },
      ],
    });

    expect((await criar().parseWebhook(cobranca(2800, 2800))).status).toBe('REFUNDED');
    expect((await criar().parseWebhook(cobranca(2800, 1000))).status).toBe('PARTIALLY_REFUNDED');
    expect((await criar().parseWebhook(cobranca(2800, 0))).status).toBe('CAPTURED');
  });

  /**
   * O outro lado da armadilha, direto do exemplo oficial de cancelamento:
   * devolução TOTAL deixa a cobrança CANCELED com paid=1000, refunded=1000.
   * Sem olhar o summary, isso viraria "reserva cancelada, nada foi cobrado".
   */
  it('CANCELED com dinheiro capturado e devolvido é devolução, não cancelamento', async () => {
    const evento = await criar().parseWebhook({
      id: 'ORDE_1',
      charges: [
        {
          id: 'CHAR_1',
          status: 'CANCELED',
          amount: { value: 1000, summary: { total: 1000, paid: 1000, refunded: 1000 } },
        },
      ],
    });

    expect(evento.status).toBe('REFUNDED');
  });

  it('CANCELED sem captura é cancelamento de reserva mesmo', async () => {
    const evento = await criar().parseWebhook({
      id: 'ORDE_1',
      charges: [
        {
          id: 'CHAR_1',
          status: 'CANCELED',
          amount: { value: 20000, summary: { total: 20000, paid: 0, refunded: 0 } },
        },
      ],
    });

    expect(evento.status).toBe('VOIDED');
  });

  it('recusa evento sem identificador', async () => {
    await expect(criar().parseWebhook({ charges: [{ status: 'PAID' }] })).rejects.toMatchObject({
      code: 'MALFORMED',
    });
  });

  /**
   * Estado desconhecido vira FALHA, nunca sucesso. Tratar o que não se entende
   * como aprovado é como se confirma recarga sem pagamento.
   */
  it('estado desconhecido vira FAILED', async () => {
    const evento = await criar().parseWebhook({
      id: 'evt_2',
      charges: [{ id: 'chg_2', status: 'ALGO_QUE_NAO_CONHECEMOS' }],
    });

    expect(evento.status).toBe('FAILED');
  });
});
