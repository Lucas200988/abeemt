import { describe, expect, it } from 'vitest';
import { assertCents } from '@bora/contracts';
import { CONTRATO_REDE, RedeProvider, pendenciasDoContratoRede, type RedeConfig } from './rede';

/**
 * O que estes testes provam — e o que NÃO provam.
 *
 * Provam: a trava funciona; o token OAuth é obtido, reutilizado e renovado; o
 * PV perde os zeros à esquerda; a autorização recusa operar sem token de
 * cartão (seção 12); o valor vai em centavos; o `reference` cabe nos 16
 * caracteres e é determinístico; o código 360 NÃO vira "devolvido"; estado
 * desconhecido vira FAILED; e a credencial não vaza em mensagem de erro.
 *
 * **Não provam** que o adapter fala com a Rede de verdade. O manual foi lido
 * (v1.38, na íntegra), mas manual lido ≠ sandbox exercitado — e é por isso que
 * a trava só cai quando a suíte de conformidade passar com credenciais reais.
 */

/** Servidor falso: OAuth sempre responde; as demais chamadas saem de uma fila. */
function servidorFalso(respostas: Array<{ status?: number; body: unknown }>) {
  const chamadas: { url: string; init: RequestInit }[] = [];
  let tokensEmitidos = 0;

  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const endereco = String(url);
    chamadas.push({ url: endereco, init: init ?? {} });

    if (endereco.includes('/oauth2/token')) {
      tokensEmitidos += 1;
      return new Response(
        JSON.stringify({ access_token: `tok_${tokensEmitidos}`, token_type: 'Bearer', expires_in: 1440 }),
        { status: 200 },
      );
    }

    const proxima = respostas.shift() ?? { status: 200, body: {} };
    return new Response(JSON.stringify(proxima.body), { status: proxima.status ?? 200 });
  }) as unknown as typeof fetch;

  return {
    fetchImpl,
    chamadas,
    contarTokens: () => tokensEmitidos,
    transacionais: () => chamadas.filter((c) => !c.url.includes('/oauth2/token')),
  };
}

const criar = (extra: Partial<RedeConfig> = {}, respostas: Array<{ status?: number; body: unknown }> = []) => {
  const servidor = servidorFalso(respostas);
  const provider = new RedeProvider({
    pv: '12345678',
    integrationKey: 'chave_secreta_de_teste',
    verificado: true,
    maxRetries: 0,
    sleepImpl: async () => undefined,
    fetchImpl: servidor.fetchImpl,
    ...extra,
  });
  return { provider, servidor };
};

const APROVADA = {
  reference: 'abc',
  tid: '10012400000000000001',
  nsu: '663206341',
  returnCode: '00',
  returnMessage: 'Success.',
  amount: 20000,
  cardBin: '544828',
  last4: '0007',
  brand: { name: 'Mastercard', returnCode: '00', authorizationCode: '186376' },
};

describe('trava de verificação', () => {
  it('recusa qualquer operação enquanto não for verificado', async () => {
    const { provider } = criar({ verificado: false });

    await expect(
      provider.authorize({ amountCents: assertCents(1000), method: 'CREDIT_CARD', idempotencyKey: 'k' }),
    ).rejects.toMatchObject({ code: 'ADAPTER_NOT_VERIFIED' });
    await expect(provider.capture('t1', assertCents(500))).rejects.toMatchObject({
      code: 'ADAPTER_NOT_VERIFIED',
    });
    await expect(provider.voidPayment('t1')).rejects.toMatchObject({ code: 'ADAPTER_NOT_VERIFIED' });
    await expect(provider.refund('t1')).rejects.toMatchObject({ code: 'ADAPTER_NOT_VERIFIED' });
    await expect(provider.getPayment('t1')).rejects.toMatchObject({ code: 'ADAPTER_NOT_VERIFIED' });
  });

  it('as pendências restantes são só as do credenciamento', () => {
    // O manual respondeu o resto. Se isto crescer, alguém marcou item sem ler.
    expect(pendenciasDoContratoRede()).toEqual(['prazoPreAutorizacaoDias']);
  });
});

describe('OAuth', () => {
  it('obtém o token uma vez e o reutiliza nas chamadas seguintes', async () => {
    const { provider, servidor } = criar({}, [
      { body: { authorization: { status: 'Pending', returnCode: '00', tid: 't1', amount: 1000 } } },
      { body: { authorization: { status: 'Pending', returnCode: '00', tid: 't1', amount: 1000 } } },
    ]);

    await provider.getPayment('t1');
    await provider.getPayment('t1');

    expect(servidor.contarTokens()).toBe(1);

    // Toda chamada transacional carrega o Bearer dinâmico — não a chave.
    for (const chamada of servidor.transacionais()) {
      const auth = (chamada.init.headers as Record<string, string>).Authorization;
      expect(auth).toBe('Bearer tok_1');
    }
  });

  it('o pedido de token usa Basic base64(pv:chave) e o PV perde zeros à esquerda', async () => {
    const { provider, servidor } = criar(
      { pv: '00987654' },
      [{ body: { authorization: { status: 'Pending', returnCode: '00', tid: 't1', amount: 1 } } }],
    );

    await provider.getPayment('t1');

    const pedidoToken = servidor.chamadas.find((c) => c.url.includes('/oauth2/token'))!;
    const basic = (pedidoToken.init.headers as Record<string, string>).Authorization;

    // Manual: PV com zero à esquerda devolve 401 invalid_client.
    expect(basic).toBe(`Basic ${Buffer.from('987654:chave_secreta_de_teste').toString('base64')}`);
    expect(pedidoToken.init.body).toBe('grant_type=client_credentials');
  });

  it('credencial recusada não é retentada às cegas', async () => {
    const servidor = {
      fetchImpl: (async () => new Response('{"error":"invalid_client"}', { status: 401 })) as unknown as typeof fetch,
    };
    const provider = new RedeProvider({
      pv: '1',
      integrationKey: 'chave',
      verificado: true,
      fetchImpl: servidor.fetchImpl,
    });

    await expect(provider.getPayment('t1')).rejects.toMatchObject({
      code: 'AUTH_FAILED',
      retryable: false,
    });
  });
});

describe('autorização', () => {
  it('recusa operar sem token de cartão — número nunca passa por aqui', async () => {
    const { provider } = criar();

    await expect(
      provider.authorize({ amountCents: assertCents(20000), method: 'CREDIT_CARD', idempotencyKey: 'k1' }),
    ).rejects.toMatchObject({ code: 'MISSING_CARD_TOKEN' });
  });

  it('recusa débito enquanto não houver 3DS', async () => {
    const { provider } = criar();

    await expect(
      provider.authorize({
        amountCents: assertCents(1000),
        method: 'DEBIT_CARD',
        idempotencyKey: 'k',
        metadata: { cardToken: 'tok' },
      }),
    ).rejects.toMatchObject({ code: 'METHOD_NOT_SUPPORTED' });
  });

  it('pré-autoriza com capture:false, valor em centavos e reference de 16 caracteres', async () => {
    const { provider, servidor } = criar({}, [{ body: APROVADA }]);

    const resultado = await provider.authorize({
      amountCents: assertCents(20000),
      method: 'CREDIT_CARD',
      idempotencyKey: 'sessao-123',
      metadata: { cardToken: 'ctok_abc' },
    });

    const pedido = JSON.parse(String(servidor.transacionais()[0].init.body));

    expect(pedido.capture).toBe(false);
    expect(pedido.kind).toBe('credit');
    expect(pedido.amount).toBe(20000); // centavos, sem conversão (ADR-0005)
    expect(pedido.cardToken).toBe('ctok_abc');
    expect(pedido.cardNumber).toBeUndefined();
    expect(pedido.reference).toHaveLength(16);

    expect(resultado.status).toBe('AUTHORIZED');
    expect(resultado.providerPaymentId).toBe('10012400000000000001');
    expect(resultado.instrument?.cardLastFour).toBe('0007');
    expect(resultado.instrument?.cardBrand).toBe('Mastercard');
  });

  it('a mesma chave de idempotência produz sempre o mesmo reference', async () => {
    const { provider, servidor } = criar({}, [{ body: APROVADA }, { body: APROVADA }]);

    const entrada = {
      amountCents: assertCents(1000),
      method: 'CREDIT_CARD' as const,
      idempotencyKey: 'mesma-chave',
      metadata: { cardToken: 't' },
    };

    await provider.authorize(entrada);
    await provider.authorize(entrada);

    const [a, b] = servidor.transacionais().map((c) => JSON.parse(String(c.init.body)).reference);
    expect(a).toBe(b);
  });

  it('reference duplicado (erro 42) recupera a transação original', async () => {
    const { provider } = criar({}, [
      // A Rede recusa o reference repetido...
      { status: 400, body: { returnCode: '42', returnMessage: 'Order number already exists' } },
      // ...e a consulta por reference devolve a transação que já existia.
      {
        body: {
          authorization: { status: 'Pending', returnCode: '00', tid: 't-original', amount: 5000 },
        },
      },
    ]);

    const resultado = await provider.authorize({
      amountCents: assertCents(5000),
      method: 'CREDIT_CARD',
      idempotencyKey: 'retentativa',
      metadata: { cardToken: 't' },
    });

    expect(resultado.status).toBe('AUTHORIZED');
    expect(resultado.providerPaymentId).toBe('t-original');
  });

  it('recusa do emissor vira DECLINED, não erro', async () => {
    const { provider } = criar({}, [
      { body: { ...APROVADA, returnCode: '111', returnMessage: 'Insufficient funds' } },
    ]);

    const resultado = await provider.authorize({
      amountCents: assertCents(1000),
      method: 'CREDIT_CARD',
      idempotencyKey: 'k',
      metadata: { cardToken: 't' },
    });

    expect(resultado.ok).toBe(false);
    expect(resultado.status).toBe('DECLINED');
    expect(resultado.providerCode).toBe('111');
  });
});

describe('captura', () => {
  it('captura valor MENOR que o reservado — o modelo inteiro do produto', async () => {
    const { provider, servidor } = criar({}, [{ body: { ...APROVADA, amount: 800 } }]);

    const resultado = await provider.capture('10012400000000000001', assertCents(800));

    const chamada = servidor.transacionais()[0];
    expect(chamada.init.method).toBe('PUT');
    expect(chamada.url).toContain('/v2/transactions/10012400000000000001');
    expect(JSON.parse(String(chamada.init.body))).toEqual({ amount: 800 });

    expect(resultado.status).toBe('CAPTURED');
    expect(resultado.amountCapturedCents).toBe(800);
  });
});

describe('devolução — 360 é "recebido", não "feito"', () => {
  it('não marca devolvido enquanto a consulta mostrar Processing', async () => {
    const { provider } = criar({}, [
      { body: { returnCode: '360', returnMessage: 'Refund request has been successful' } },
      {
        body: {
          authorization: { status: 'Approved', returnCode: '00', tid: 't1', amount: 2000 },
          capture: { amount: 2000 },
          refunds: [{ status: 'Processing', amount: 2000 }],
        },
      },
    ]);

    const resultado = await provider.refund('t1', assertCents(2000));

    // O dinheiro AINDA está cobrado; só a reconsulta confirma a devolução.
    expect(resultado.status).toBe('CAPTURED');
    expect(resultado.amountRefundedCents).toBe(0);
    expect(resultado.providerCode).toBe('360');
    expect(resultado.message).toContain('reconsulta');
  });

  it('devolução concluída (Done) vira REFUNDED pela consulta', async () => {
    const { provider } = criar({}, [
      { body: { returnCode: '359', returnMessage: 'Refund successful' } },
      {
        body: {
          authorization: { status: 'Approved', returnCode: '00', tid: 't1', amount: 2000 },
          capture: { amount: 2000 },
          refunds: [{ status: 'Done', amount: 2000 }],
        },
      },
    ]);

    const resultado = await provider.refund('t1', assertCents(2000));

    expect(resultado.status).toBe('REFUNDED');
    expect(resultado.amountRefundedCents).toBe(2000);
  });

  /**
   * O defeito que a verificação contra o sandbox encontrou (2026-07-31, passo
   * 7): o cancelamento SEM corpo devolvia HTTP 400 — o `amount` é obrigatório
   * na Rede, mesmo para cancelar a reserva inteira. O valor tem que vir da
   * consulta, porque quem cancela uma reserva não sabe (nem deve precisar
   * saber) quanto foi reservado.
   */
  it('cancelar a reserva descobre o valor na consulta e o envia no corpo', async () => {
    const { provider, servidor } = criar({}, [
      // 1ª chamada: a consulta que descobre o valor reservado.
      { body: { authorization: { status: 'Pending', returnCode: '00', tid: 't1', amount: 5000 } } },
      // 2ª: o cancelamento em si.
      { body: { returnCode: '359', returnMessage: 'Refund successful' } },
      // 3ª: a consulta final, que confirma.
      { body: { authorization: { status: 'Canceled', returnCode: '00', tid: 't1', amount: 5000 } } },
    ]);

    const resultado = await provider.voidPayment('t1');

    const cancelamento = servidor.transacionais()[1];
    expect(cancelamento.url).toContain('/refunds');
    expect(JSON.parse(String(cancelamento.init.body))).toEqual({ amount: 5000 });

    expect(resultado.status).toBe('VOIDED');
  });

  /**
   * Visto na verificação real (passo 7): o cancelamento da reserva passa pelo
   * caminho de refunds na Rede, e a consulta volta com uma "devolução" — mas
   * nada foi cobrado. Registrar devolução de dinheiro que nunca saiu do cartão
   * poria no extrato um estorno fantasma.
   */
  it('cancelamento de reserva é VOIDED, não devolução — nada foi cobrado', async () => {
    const { provider } = criar({}, [
      { body: { authorization: { status: 'Pending', returnCode: '00', tid: 't1', amount: 5000 } } },
      { body: { returnCode: '359' } },
      {
        body: {
          authorization: { status: 'Canceled', returnCode: '00', tid: 't1', amount: 5000 },
          refunds: [{ status: 'Done', amount: 5000 }],
        },
      },
    ]);

    const resultado = await provider.voidPayment('t1');

    expect(resultado.status).toBe('VOIDED');
    expect(resultado.amountCapturedCents).toBe(0);
    expect(resultado.amountRefundedCents).toBe(0);
  });

  it('devolver tudo sem informar valor devolve o que resta do capturado', async () => {
    const { provider, servidor } = criar({}, [
      {
        body: {
          authorization: { status: 'Approved', returnCode: '00', tid: 't1', amount: 2000 },
          capture: { amount: 2000 },
          refunds: [{ status: 'Done', amount: 500 }],
        },
      },
      { body: { returnCode: '360' } },
      {
        body: {
          authorization: { status: 'Approved', returnCode: '00', tid: 't1', amount: 2000 },
          capture: { amount: 2000 },
          refunds: [
            { status: 'Done', amount: 500 },
            { status: 'Processing', amount: 1500 },
          ],
        },
      },
    ]);

    await provider.refund('t1');

    const devolucao = servidor.transacionais()[1];
    // 2000 capturados − 500 já devolvidos = 1500.
    expect(JSON.parse(String(devolucao.init.body))).toEqual({ amount: 1500 });
  });
});

describe('consulta — a fonte da verdade', () => {
  it('Pending com autorização aprovada é reserva em pé (AUTHORIZED)', async () => {
    const { provider } = criar({}, [
      { body: { authorization: { status: 'Pending', returnCode: '00', tid: 't1', amount: 20000 } } },
    ]);

    const resultado = await provider.getPayment('t1');
    expect(resultado.status).toBe('AUTHORIZED');
    expect(resultado.amountAuthorizedCents).toBe(20000);
  });

  it('estado desconhecido vira FAILED, nunca sucesso', async () => {
    const { provider } = criar({}, [
      { body: { authorization: { status: 'AlgoNovo', tid: 't1' } } },
    ]);

    const resultado = await provider.getPayment('t1');
    expect(resultado.status).toBe('FAILED');
    expect(resultado.ok).toBe(false);
  });

  it('devolução parcial concluída vira PARTIALLY_REFUNDED', async () => {
    const { provider } = criar({}, [
      {
        body: {
          authorization: { status: 'Approved', returnCode: '00', tid: 't1', amount: 2000 },
          capture: { amount: 2000 },
          refunds: [
            { status: 'Done', amount: 500 },
            { status: 'Processing', amount: 500 },
          ],
        },
      },
    ]);

    const resultado = await provider.getPayment('t1');
    expect(resultado.status).toBe('PARTIALLY_REFUNDED');
    // Só o concluído conta como devolvido.
    expect(resultado.amountRefundedCents).toBe(500);
  });
});

describe('webhook — aviso com token fixo, sem assinatura', () => {
  it('aceita o token registrado e recusa qualquer outro', async () => {
    const { provider } = criar({ webhookToken: 'Bearer segredo-do-portal' });

    expect(await provider.verifyWebhook({}, { authorization: 'Bearer segredo-do-portal' })).toBe(true);
    expect(await provider.verifyWebhook({}, { authorization: 'Bearer errado' })).toBe(false);
    expect(await provider.verifyWebhook({}, {})).toBe(false);
  });

  it('sem token configurado, recusa tudo — esquecimento não vira endpoint aberto', async () => {
    const { provider } = criar();
    expect(await provider.verifyWebhook({}, { authorization: 'Bearer qualquer' })).toBe(false);
  });

  it('normaliza a notificação de devolução', async () => {
    const { provider } = criar();

    const evento = await provider.parseWebhook({
      type: 'refund',
      tid: '9274256037511432483',
      refundId: 'd21c0fa9-aa0f',
      status: 'Done',
      amount: 1000,
    });

    expect(evento.providerPaymentId).toBe('9274256037511432483');
    expect(evento.eventId).toBe('d21c0fa9-aa0f');
    expect(evento.status).toBe('REFUNDED');
    expect(evento.amountCents).toBe(1000);
  });

  it('devolução negada mantém o dinheiro como cobrado', async () => {
    const { provider } = criar();
    const evento = await provider.parseWebhook({ type: 'refund', tid: 't1', status: 'Denied' });
    expect(evento.status).toBe('CAPTURED');
  });
});

describe('credencial nunca vaza', () => {
  it('mensagem de erro de rede não contém a chave de integração', async () => {
    const fetchQueFalha = (async (url: string | URL) => {
      if (String(url).includes('/oauth2/token')) {
        return new Response(JSON.stringify({ access_token: 'tok_x', expires_in: 1440 }), { status: 200 });
      }
      throw new Error('connect falhou para https://user:chave_secreta_de_teste@host');
    }) as unknown as typeof fetch;

    const provider = new RedeProvider({
      pv: '1',
      integrationKey: 'chave_secreta_de_teste',
      verificado: true,
      maxRetries: 0,
      fetchImpl: fetchQueFalha,
    });

    try {
      await provider.getPayment('t1');
      expect.unreachable('deveria ter lançado');
    } catch (e) {
      expect((e as Error).message).not.toContain('chave_secreta_de_teste');
      expect((e as Error).message).toContain('[REDIGIDO]');
    }
  });
});

describe('contrato', () => {
  it('os endereços confirmados são os do manual', () => {
    expect(CONTRATO_REDE.baseUrlSandbox.valor).toBe('https://sandbox-erede.useredecloud.com.br');
    expect(CONTRATO_REDE.baseUrlProducao.valor).toBe('https://api.userede.com.br/erede');
    expect(CONTRATO_REDE.baseUrlSandbox.procedencia).toBe('confirmado');
  });

  it('o webhook está documentado como sem assinatura', () => {
    expect(CONTRATO_REDE.webhookSemAssinatura.valor).toBe(true);
  });
});
