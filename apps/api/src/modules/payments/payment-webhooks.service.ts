import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@bora/database';
import type { PaymentWebhookEvent } from '@bora/payment-core';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentProviderRegistry } from './payment-provider.registry';

/**
 * Recebimento de eventos do provedor.
 *
 * Duas garantias, nesta ordem:
 *
 *  1. **Assinatura.** Sem verificar, qualquer um que descubra a URL confirma
 *     pagamentos e ganha recarga de graça. Por isso a assinatura é conferida
 *     ANTES de qualquer leitura do corpo.
 *  2. **Idempotência.** Adquirentes reenviam o mesmo evento até receber 200.
 *     Quem impede o processamento repetido é o índice único
 *     `(provider, eventId)` no banco — não uma verificação em memória, que
 *     perderia a corrida entre dois reenvios simultâneos (risco R-08).
 */

export interface WebhookOutcome {
  received: boolean;
  duplicate: boolean;
  message: string;
}

@Injectable()
export class PaymentWebhooksService {
  private readonly logger = new Logger(PaymentWebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: PaymentProviderRegistry,
  ) {}

  async handle(
    providerName: string,
    payload: unknown,
    headers: Record<string, string>,
    rawBody?: Buffer,
  ): Promise<WebhookOutcome> {
    const provider = this.providers.get(providerName);

    const assinaturaValida = await provider.verifyWebhook(payload, headers, rawBody);
    if (!assinaturaValida) {
      this.logger.warn({ provider: providerName }, 'webhook com assinatura inválida — recusado');

      throw new UnauthorizedException({
        code: 'INVALID_WEBHOOK_SIGNATURE',
        message: 'Assinatura inválida.',
      });
    }

    const evento = await provider.parseWebhook(payload);

    const pagamento = await this.prisma.payment.findFirst({
      where: { provider: providerName, providerPaymentId: evento.providerPaymentId },
      select: { id: true, status: true, method: true },
    });

    let registro;
    try {
      registro = await this.prisma.paymentEvent.create({
        data: {
          provider: providerName,
          eventId: evento.eventId,
          paymentId: pagamento?.id,
          providerPaymentId: evento.providerPaymentId,
          status: evento.status,
          amountCents: evento.amountCents,
          occurredAt: evento.occurredAt,
          payload: (payload ?? {}) as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Reenvio. Respondemos sucesso para o provedor parar de tentar.
        this.logger.log(
          { provider: providerName, eventId: evento.eventId },
          'webhook repetido — ignorado',
        );

        return { received: true, duplicate: true, message: 'Evento já processado.' };
      }

      throw error;
    }

    if (!pagamento) {
      // Evento de pagamento que não conhecemos. Guardado para conciliação: pode
      // ser de outro ambiente apontando para a mesma URL, ou de um pagamento
      // criado direto no adquirente.
      this.logger.warn(
        { provider: providerName, providerPaymentId: evento.providerPaymentId },
        'webhook de pagamento desconhecido — registrado sem processar',
      );

      await this.prisma.paymentEvent.update({
        where: { id: registro.id },
        data: { processedAt: new Date(), processingError: 'pagamento não encontrado' },
      });

      return { received: true, duplicate: false, message: 'Evento registrado.' };
    }

    try {
      await this.aplicar(pagamento.id, evento);

      await this.prisma.paymentEvent.update({
        where: { id: registro.id },
        data: { processedAt: new Date() },
      });

      return { received: true, duplicate: false, message: 'Evento processado.' };
    } catch (error) {
      // O evento fica gravado sem `processedAt`: é a fila de conciliação. Não
      // devolvemos erro ao provedor porque o reenvio bateria na idempotência e
      // seria descartado — resolver isto é trabalho nosso, não dele.
      const detalhe = error instanceof Error ? error.message : String(error);

      this.logger.error(
        { err: error, provider: providerName, eventId: evento.eventId },
        'falha ao processar webhook — evento guardado para conciliação',
      );

      await this.prisma.paymentEvent.update({
        where: { id: registro.id },
        data: { processingError: detalhe },
      });

      return { received: true, duplicate: false, message: 'Evento registrado para revisão.' };
    }
  }

  /**
   * Aplica o estado que o provedor informou.
   *
   * O webhook é fonte de verdade sobre o pagamento — inclusive quando contradiz
   * o que gravamos: uma captura pode ser desfeita pelo emissor depois de nós
   * termos registrado sucesso.
   */
  private async aplicar(paymentId: string, evento: PaymentWebhookEvent): Promise<void> {
    const agora = new Date();

    await this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: evento.status,
        capturedAt: evento.status === 'CAPTURED' ? agora : undefined,
        cancelledAt: evento.status === 'VOIDED' ? agora : undefined,
        refundedAt:
          evento.status === 'REFUNDED' || evento.status === 'PARTIALLY_REFUNDED'
            ? agora
            : undefined,
        amountCapturedCents: evento.status === 'CAPTURED' ? evento.amountCents : undefined,
      },
    });

    /**
     * Pré-autorização expirada é o risco R-23: se houve energia entregue, ela
     * não será faturada. Registramos na sessão para o operador ver, porque não
     * há ação automática possível — o dinheiro já foi liberado pelo emissor.
     */
    if (evento.status === 'EXPIRED') {
      const sessao = await this.prisma.chargingSession.findUnique({
        where: { paymentId },
        select: { id: true, energyWh: true },
      });

      if (sessao && (sessao.energyWh ?? 0) > 0) {
        this.logger.error(
          { sessionId: sessao.id, paymentId, energyWh: sessao.energyWh },
          'pré-autorização expirou com energia entregue — cobrança perdida',
        );

        await this.prisma.chargingSession.update({
          where: { id: sessao.id },
          data: {
            failureReason:
              'a pré-autorização expirou antes da cobrança; a energia entregue não foi faturada',
          },
        });
      }
    }
  }
}
