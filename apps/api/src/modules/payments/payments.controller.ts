import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { PaymentsService } from './payments.service';
import { AuditService } from '../audit/audit.service';
import {
  ListPaymentsQueryDto,
  RecordTerminalAuthorizationDto,
  RefundPaymentDto,
  StartPaidSessionDto,
} from './dto/payment.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireRole } from '../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

@ApiTags('Pagamentos')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly audit: AuditService,
  ) {}

  private ctx(request: Request) {
    return { ipAddress: request.ip, userAgent: request.get('user-agent') };
  }

  @Get()
  @ApiOperation({ summary: 'Lista pagamentos' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListPaymentsQueryDto) {
    return this.payments.list(user, query, query);
  }

  @Get('providers')
  @ApiOperation({
    summary: 'Provedores de pagamento registrados',
    description: 'Informa qual é o padrão e quais são simulados, para o painel avisar na tela.',
  })
  providers() {
    return this.payments.providerInfo();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe do pagamento' })
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.get(user, id);
  }

  /**
   * Início de recarga paga.
   *
   * Exige papel de operador porque, até a FASE 8, quem dispara é o painel. O
   * fluxo do motorista sem conta (a maquininha) entra pelo endpoint do terminal,
   * que tem autenticação própria.
   */
  @RequireRole('OPERATOR')
  @Post('start-session')
  @ApiOperation({
    summary: 'Reserva o valor e inicia a recarga',
    description:
      'Pré-autorização + captura pelo consumo real (ADR-0008). No Pix, o valor é ' +
      'cobrado na hora, porque não existe captura parcial (ADR-0010).',
  })
  async startSession(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: StartPaidSessionDto,
    @Req() request: Request,
  ) {
    const resultado = await this.payments.startPaidSession(dto);

    await this.audit.record({
      user,
      action: 'payment.start_session',
      entityType: 'Payment',
      entityId: resultado.paymentId,
      newValue: {
        sessionId: resultado.sessionId,
        method: dto.method,
        amountAuthorizedCents: resultado.amountAuthorizedCents,
        approved: resultado.approved,
      },
      ...this.ctx(request),
    });

    return resultado;
  }

  @RequireRole('OPERATOR')
  @Post('terminal-authorization')
  @ApiOperation({
    summary: 'Registra uma pré-autorização feita na maquininha',
    description:
      'O terminal já autorizou pelo SDK do fabricante; aqui apenas guardamos o ' +
      'resultado e mandamos o carregador iniciar. Nenhuma chamada a adquirente parte daqui.',
  })
  async terminalAuthorization(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RecordTerminalAuthorizationDto,
    @Req() request: Request,
  ) {
    const resultado = await this.payments.recordTerminalAuthorization({
      connectorId: dto.connectorId,
      provider: dto.provider,
      providerPaymentId: dto.providerPaymentId,
      method: dto.method,
      amountAuthorizedCents: dto.amountAuthorizedCents,
      idempotencyKey: dto.idempotencyKey,
      terminalId: dto.terminalId,
      instrument: {
        cardBrand: dto.cardBrand,
        cardLastFour: dto.cardLastFour,
        nsu: dto.nsu,
        authorizationCode: dto.authorizationCode,
        terminalId: dto.terminalId,
      },
    });

    await this.audit.record({
      user,
      action: 'payment.terminal_authorization',
      entityType: 'Payment',
      entityId: resultado.paymentId,
      newValue: {
        sessionId: resultado.sessionId,
        provider: dto.provider,
        terminalId: dto.terminalId,
        amountAuthorizedCents: dto.amountAuthorizedCents,
      },
      ...this.ctx(request),
    });

    return resultado;
  }

  /**
   * Devolução manual.
   *
   * Restrita a ORG_ADMIN: devolver dinheiro é decisão financeira, não operação
   * de rotina. O motivo é obrigatório e vai para a auditoria com o nome de quem
   * decidiu — a pergunta "quem autorizou este estorno?" aparece no primeiro
   * fechamento de caixa.
   */
  @RequireRole('ORG_ADMIN')
  @Post(':id/refund')
  @ApiOperation({ summary: 'Devolve ou cancela um pagamento' })
  async refund(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefundPaymentDto,
    @Req() request: Request,
  ) {
    // Confere o escopo antes de mexer em dinheiro: sem isto, um administrador
    // devolveria o pagamento de outro estabelecimento pelo id.
    const antes = await this.payments.get(user, id);
    const resultado = await this.payments.refund(id, dto.amountCents);

    await this.audit.record({
      user,
      action: 'payment.refund',
      entityType: 'Payment',
      entityId: id,
      previousValue: { status: antes.status, amountCapturedCents: antes.amountCapturedCents },
      newValue: { status: resultado.status, amountCents: dto.amountCents, motivo: dto.reason },
      ...this.ctx(request),
    });

    return resultado;
  }
}
