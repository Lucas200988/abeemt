import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

const METODOS = ['CREDIT_CARD', 'DEBIT_CARD', 'PIX', 'MANUAL'] as const;
const STATUS = [
  'PENDING',
  'AUTHORIZED',
  'CAPTURED',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
  'VOIDED',
  'DECLINED',
  'EXPIRED',
  'FAILED',
] as const;

/**
 * Teto absoluto aceito em qualquer valor monetário da API.
 *
 * R$ 10.000,00. Não é limite de negócio — é barreira contra erro de digitação e
 * contra alguém mandar centavos onde queria reais. Uma recarga de 30 kW não
 * chega perto disso.
 */
const TETO_ABSOLUTO_CENTS = 1_000_000;

export class StartPaidSessionDto {
  @ApiProperty({ description: 'Conector onde a recarga deve começar.' })
  @IsUUID()
  connectorId!: string;

  @ApiProperty({ enum: METODOS })
  @IsIn(METODOS)
  method!: (typeof METODOS)[number];

  @ApiPropertyOptional({
    description:
      'Valor a RESERVAR em CENTAVOS. Omitido, usa a hierarquia do ADR-0008 §9. ' +
      'No Pix é o valor efetivamente pago, porque não há captura parcial.',
    example: 20000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'O valor precisa ser um inteiro em centavos (ADR-0005).' })
  @Min(1)
  @Max(TETO_ABSOLUTO_CENTS)
  amountCents?: number;

  @ApiPropertyOptional({
    description: 'Chave de idempotência. Repetir a mesma chave não gera dois pagamentos.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;

  @ApiPropertyOptional({ description: 'Identificador do terminal, quando houver.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  terminalId?: string;
}

/**
 * Autorização vinda da maquininha.
 *
 * Os campos aceitos são exatamente os que podemos guardar. Número completo, CVV
 * e trilha não existem neste DTO de propósito: o que não é declarado é rejeitado
 * pelo `forbidNonWhitelisted`, então um terminal que mande dados a mais recebe
 * 400 em vez de gravá-los (briefing seção 12).
 */
export class RecordTerminalAuthorizationDto {
  @ApiProperty() @IsUUID() connectorId!: string;

  @ApiProperty({ description: 'Nome do provedor registrado (ex.: "manual").' })
  @IsString()
  @MaxLength(32)
  provider!: string;

  @ApiProperty({ description: 'Identificador do pagamento no provedor.' })
  @IsString()
  @MaxLength(128)
  providerPaymentId!: string;

  @ApiProperty({ enum: METODOS })
  @IsIn(METODOS)
  method!: (typeof METODOS)[number];

  @ApiProperty({ description: 'Valor pré-autorizado no terminal, em CENTAVOS.', example: 20000 })
  @Type(() => Number)
  @IsInt({ message: 'O valor precisa ser um inteiro em centavos (ADR-0005).' })
  @Min(1)
  @Max(TETO_ABSOLUTO_CENTS)
  amountAuthorizedCents!: number;

  @ApiProperty({ description: 'Chave de idempotência gerada pelo terminal.' })
  @IsString()
  @MaxLength(128)
  idempotencyKey!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) cardBrand?: string;

  @ApiPropertyOptional({ description: 'Somente os quatro últimos dígitos.' })
  @IsOptional()
  @Matches(/^\d{4}$/, { message: 'cardLastFour precisa ter exatamente 4 dígitos.' })
  cardLastFour?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) nsu?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  authorizationCode?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) terminalId?: string;
}

export class RefundPaymentDto {
  @ApiPropertyOptional({
    description: 'Valor a devolver em CENTAVOS. Omitido, devolve tudo o que foi cobrado.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'O valor precisa ser um inteiro em centavos (ADR-0005).' })
  @Min(1)
  @Max(TETO_ABSOLUTO_CENTS)
  amountCents?: number;

  @ApiProperty({ description: 'Motivo da devolução. Obrigatório: fica na auditoria.' })
  @IsString()
  @MaxLength(300)
  reason!: string;
}

export class ListPaymentsQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: STATUS })
  @IsOptional()
  @IsIn(STATUS)
  status?: (typeof STATUS)[number];

  @ApiPropertyOptional({ enum: METODOS })
  @IsOptional()
  @IsIn(METODOS)
  method?: (typeof METODOS)[number];
}
