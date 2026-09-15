import { Body, Controller, Headers, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiExcludeController, ApiOperation } from '@nestjs/swagger';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { PaymentWebhooksService } from './payment-webhooks.service';
import { Public } from '../../common/decorators/public.decorator';

/**
 * Recebimento de eventos do provedor de pagamento.
 *
 * Rota pública porque quem chama é o adquirente, que não tem — nem deve ter —
 * usuário no painel. O que autentica a chamada é a **assinatura do corpo**,
 * verificada no serviço antes de qualquer processamento.
 *
 * Fora do Swagger de propósito: publicar o formato do webhook não ajuda ninguém
 * e facilita quem quiser tentar forjar um.
 */
@ApiExcludeController()
@Controller('webhooks/payments')
export class PaymentWebhooksController {
  constructor(private readonly webhooks: PaymentWebhooksService) {}

  @Public()
  @Post(':provider')
  // 200, e não 201: a resposta confirma recebimento, não criação de recurso —
  // e adquirentes costumam tratar qualquer coisa fora de 2xx como falha.
  @HttpCode(200)
  @ApiOperation({ summary: 'Recebe eventos de pagamento' })
  handle(
    @Param('provider') provider: string,
    @Body() payload: unknown,
    @Headers() headers: Record<string, string>,
    @Req() request: RawBodyRequest<Request>,
  ) {
    // O corpo cru é o que a assinatura cobre. Passamos os dois: o objeto para
    // interpretar o evento, os bytes para conferir a assinatura.
    return this.webhooks.handle(provider, payload, headers, request.rawBody);
  }
}
