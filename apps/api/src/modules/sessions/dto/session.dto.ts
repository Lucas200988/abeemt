import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

const STATUS = [
  'AWAITING_PAYMENT',
  'PAYMENT_APPROVED',
  'AWAITING_CHARGER',
  'COMMAND_SENT',
  'STARTING',
  'CHARGING',
  'FINISHING',
  'COMPLETED',
  'DECLINED',
  'CANCELLED',
  'FAILED',
  'EXPIRED',
] as const;

/** Herda a paginação — ver a nota em ListChargersQueryDto. */
export class ListSessionsQueryDto extends PaginationDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() chargerId?: string;

  @ApiPropertyOptional({ enum: STATUS })
  @IsOptional()
  @IsIn(STATUS)
  status?: (typeof STATUS)[number];

  @ApiPropertyOptional({ description: 'Apenas sessões em andamento.' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  activeOnly?: boolean;
}

export class StartManualSessionDto {
  @ApiProperty({ description: 'Conector onde a recarga deve começar.' })
  @IsUUID()
  connectorId!: string;

  @ApiPropertyOptional({
    description:
      'Teto da sessão em CENTAVOS. Omitido, usa a hierarquia do ADR-0008 §9 (carregador → estabelecimento → organização → padrão).',
    example: 20000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'O teto precisa ser um valor inteiro em centavos (ADR-0005).' })
  @Min(1)
  ceilingAmountCents?: number;
}

export class CancelSessionDto {
  @ApiPropertyOptional({ description: 'Motivo, registrado na auditoria.' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}
