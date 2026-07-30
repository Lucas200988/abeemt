import { Body, Controller, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { ApiExcludeController, ApiOperation } from '@nestjs/swagger';
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
  ) {
    return this.webhooks.handle(provider, payload, headers);
  }
}
