import { describe, expect, it } from 'vitest';
import { assertCents } from '@bora/contracts';
import { assertProviderSupportsModel, type PaymentProvider } from './provider';

/**
 * Suíte de conformidade da porta de pagamento.
 *
 * É o contrato que **todo** adapter precisa cumprir, escrito uma vez e rodado
 * contra cada implementação. Existe por causa de um problema específico da
 * FASE 7: o adapter real só pode ser exercitado quando houver credenciais de
 * sandbox, e nesse dia a pergunta será "ele se comporta como o resto do sistema
 * espera?". Sem esta suíte, a resposta dependeria de alguém lembrar de conferir
 * cada regra à mão.
 *
 * Uso:
 *
 * ```ts
 * runProviderConformance('mock', () => new MockPaymentProvider());
 * ```
 *
 * Não é exportada pelo `index` de propósito: importa `vitest`, e isso não pode
 * entrar no pacote em tempo de execução.
 */

export interface ConformanceOptions {
  /**
   * Valor a reservar nos testes, em centavos. Um sandbox real pode exigir
   * valores dentro de uma faixa.
   */
  amountCents?: number;
  /**
   * Pula o ciclo que movimenta dinheiro. Serve para rodar a suíte contra um
   * adquirente real em modo somente-leitura, sem criar transações.
   */
  somenteCapacidades?: boolean;
}

export function runProviderConformance(
  nome: string,
  criar: () => PaymentProvider,
  opcoes: ConformanceOptions = {},
): void {
  const valor = opcoes.amountCents ?? 20_000;

  // Chave única por execução: repetir chave é justamente o que a idempotência
  // impede, e reaproveitá-la entre testes daria falso positivo.
  let contador = 0;
  const chave = () => `conformance-${nome}-${Date.now()}-${(contador += 1)}`;

  describe(`conformidade do provedor: ${nome}`, () => {
    describe('capacidades declaradas', () => {
      it('atende o modelo do produto (ADR-0008)', () => {
        expect(() => assertProviderSupportsModel(criar())).not.toThrow();
      });

      it('declara um nome estável', () => {
        expect(criar().name).toBe(nome);
      });

      it('declara quem inicia a autorização', () => {
        expect(['backend', 'terminal']).toContain(criar().capabilities.initiatedBy);
      });

      it('declara ao menos um meio de pagamento', () => {
        expect(criar().capabilities.methods.length).toBeGreaterThan(0);
      });

      /**
       * Um provedor `backend` sem `authorize` não consegue iniciar nada; um
       * `terminal` com `authorize` sugere que alguém implementou o caminho
       * errado. Os dois casos são erro de adapter, não de configuração.
       */
      it('a implementação combina com o que ele declara', () => {
        const p = criar();

        if (p.capabilities.initiatedBy === 'backend') {
          expect(typeof p.authorize).toBe('function');
        }
      });
    });

    if (opcoes.somenteCapacidades) return;

    describe('ciclo de vida do dinheiro', () => {
      it('autoriza sem cobrar', async () => {
        const p = criar();
        if (!p.authorize) return;

        const r = await p.authorize({
          amountCents: assertCents(valor),
          method: p.capabilities.methods[0],
          idempotencyKey: chave(),
        });

        expect(r.status).toBe('AUTHORIZED');
        expect(r.amountAuthorizedCents).toBe(valor);
        // O ponto do modelo: reservado, nada cobrado.
        expect(r.amountCapturedCents).toBe(0);
        expect(r.providerPaymentId).toBeTruthy();
      });

      it('captura valor MENOR que o autorizado', async () => {
        const p = criar();
        if (!p.authorize) return;

        const a = await p.authorize({
          amountCents: assertCents(valor),
          method: p.capabilities.methods[0],
          idempotencyKey: chave(),
        });

        const parcial = Math.floor(valor / 4);
        const c = await p.capture(a.providerPaymentId, assertCents(parcial));

        expect(c.status).toBe('CAPTURED');
        expect(c.amountCapturedCents).toBe(parcial);
      });

      /**
       * Risco R-22. Se o adapter aceitasse capturar acima do autorizado, o teste
       * da parada automática passaria em falso e o defeito só apareceria com
       * dinheiro real.
       */
      it('recusa captura acima do autorizado', async () => {
        const p = criar();
        if (!p.authorize) return;

        const a = await p.authorize({
          amountCents: assertCents(valor),
          method: p.capabilities.methods[0],
          idempotencyKey: chave(),
        });

        await expect(p.capture(a.providerPaymentId, assertCents(valor * 2))).rejects.toThrow();
      });

      it('cancela a reserva sem cobrar nada', async () => {
        const p = criar();
        if (!p.authorize) return;

        const a = await p.authorize({
          amountCents: assertCents(valor),
          method: p.capabilities.methods[0],
          idempotencyKey: chave(),
        });

        const v = await p.voidPayment(a.providerPaymentId);

        expect(v.status).toBe('VOIDED');
        expect(v.amountCapturedCents).toBe(0);
      });

      it('consulta um pagamento existente', async () => {
        const p = criar();
        if (!p.authorize) return;

        const a = await p.authorize({
          amountCents: assertCents(valor),
          method: p.capabilities.methods[0],
          idempotencyKey: chave(),
        });

        const consulta = await p.getPayment(a.providerPaymentId);
        expect(consulta.providerPaymentId).toBe(a.providerPaymentId);
      });

      it('falha ao operar um pagamento inexistente', async () => {
        // Um adapter que devolve sucesso para id desconhecido esconderia erro
        // de conciliação — pior do que falhar.
        await expect(criar().getPayment('id-que-nao-existe-999')).rejects.toThrow();
      });
    });

    describe('idempotência (regra 11.3)', () => {
      it('a mesma chave devolve o mesmo pagamento', async () => {
        const p = criar();
        if (!p.authorize) return;

        const k = chave();
        const entrada = {
          amountCents: assertCents(valor),
          method: p.capabilities.methods[0],
          idempotencyKey: k,
        };

        const primeira = await p.authorize(entrada);
        const segunda = await p.authorize(entrada);

        expect(segunda.providerPaymentId).toBe(primeira.providerPaymentId);
      });
    });

    describe('dados que podemos guardar (briefing seção 12)', () => {
      it('nunca devolve algo com cara de número completo de cartão', async () => {
        const p = criar();
        if (!p.authorize) return;

        const r = await p.authorize({
          amountCents: assertCents(valor),
          method: p.capabilities.methods[0],
          idempotencyKey: chave(),
        });

        const serializado = JSON.stringify(r.instrument ?? {});
        // 13 dígitos seguidos é o menor cartão real; quatro últimos são 4.
        expect(serializado).not.toMatch(/\d{13,}/);
        expect(r.instrument?.cardLastFour ?? '').not.toMatch(/^\d{5,}$/);
      });
    });

    describe('webhook', () => {
      it('recusa evento sem assinatura', async () => {
        expect(await criar().verifyWebhook({}, {})).toBe(false);
      });

      it('recusa corpo malformado', async () => {
        await expect(criar().parseWebhook({ sem: 'nada util' })).rejects.toThrow();
      });
    });
  });
}
