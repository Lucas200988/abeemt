import { createHmac } from 'node:crypto';
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
      // Lista os itens pendentes, para não obrigar ninguém a caçar.
      expect(msg).toContain('criarPedido');
    }
  });

  it('o contrato admite o que ainda não foi confirmado', () => {
    const pendentes = pendenciasDoContrato();

    // Se algum dia isto ficar vazio sem alguém ter lido a documentação, o
    // problema é maior do que um teste quebrado.
    expect(pendentes.length).toBeGreaterThan(0);
    expect(pendentes).toContain('cabecalhoAssinatura');
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
      metadata: { encryptedCard: 'blob-cifrado' },
    });

    expect(r.status).toBe('AUTHORIZED');
    expect(enviado).toContain('blob-cifrado');
    expect(enviado).not.toContain('4111');
    // E continua sendo reserva, não cobrança.
    expect(JSON.parse(enviado).charges[0].payment_method.capture).toBe(false);
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
   * Lembrete deliberado. Na verificação da Rede, o passo que achou erro real
   * foi justamente o da recusa. Enquanto esta lista estiver vazia, a
   * verificação do PagBank não pode ser declarada completa.
   */
  it('a lista de recusa ainda está vazia — a verificação não fecha sem ela', () => {
    expect(CARTOES_DE_TESTE_SANDBOX.recusados).toHaveLength(0);
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

describe('assinatura do webhook', () => {
  const segredo = 'segredo';
  const corpo = Buffer.from('{"id":"evt_1","charges":[{"id":"chg_1","status":"PAID"}]}');
  const assinatura = createHmac('sha256', segredo).update(corpo).digest('hex');

  it('aceita assinatura correta no cabeçalho do fornecedor', async () => {
    const p = criar({ webhookSecret: segredo });
    const headers = { [CONTRATO.cabecalhoAssinatura.valor]: assinatura };

    expect(await p.verifyWebhook({}, headers, corpo)).toBe(true);
  });

  it('recusa corpo adulterado', async () => {
    const p = criar({ webhookSecret: segredo });
    const adulterado = Buffer.from(
      '{"id":"evt_1","charges":[{"id":"chg_1","status":"PAID","x":1}]}',
    );

    expect(
      await p.verifyWebhook({}, { [CONTRATO.cabecalhoAssinatura.valor]: assinatura }, adulterado),
    ).toBe(false);
  });

  /**
   * A verificação de assinatura funciona mesmo sem o adapter estar verificado:
   * é criptografia, não depende do contrato. Bloqueá-la só atrapalharia o dia
   * de ligar o sandbox.
   */
  it('funciona sem depender da trava', async () => {
    const p = criar({ webhookSecret: segredo });
    expect(p.verificado).toBe(false);
    expect(
      await p.verifyWebhook({}, { [CONTRATO.cabecalhoAssinatura.valor]: assinatura }, corpo),
    ).toBe(true);
  });
});

describe('leitura do evento', () => {
  it('extrai identificadores e estado', async () => {
    const evento = await criar().parseWebhook({
      id: 'evt_1',
      charges: [{ id: 'chg_1', status: 'PAID', summary: { paid: 2800 } }],
    });

    expect(evento.eventId).toBe('evt_1');
    expect(evento.providerPaymentId).toBe('chg_1');
    expect(evento.status).toBe('CAPTURED');
    expect(evento.amountCents).toBe(2800);
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
