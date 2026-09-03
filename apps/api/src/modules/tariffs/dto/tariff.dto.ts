import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

/**
 * Todos os valores em CENTAVOS inteiros (ADR-0005).
 *
 * O painel converte reais para centavos antes de enviar. A API não aceita
 * reais: um endpoint que recebesse "12,50" precisaria decidir sozinho o
 * arredondamento, e essa decisão é comercial.
 */

/** R$ 1.000,00 por kWh. Barreira contra digitar reais no lugar de centavos. */
const TETO_UNITARIO_CENTS = 100_000;
/** R$ 10.000,00 para valores de sessão inteira. */
const TETO_SESSAO_CENTS = 1_000_000;

export class CreateTariffDto {
  @ApiProperty({ example: 'Tarifa padrão 2026' })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({
    description:
      'Organização. Só o administrador global informa; para os demais, vem do próprio usuário.',
  })
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @ApiPropertyOptional({
    description: 'Estabelecimento. Omitido, a tarifa vale para toda a organização.',
  })
  @IsOptional()
  @IsUUID()
  siteId?: string;

  @ApiProperty({ description: 'Preço por kWh em CENTAVOS. R$ 2,50 = 250.', example: 250 })
  @Type(() => Number)
  @IsInt({ message: 'pricePerKwhCents precisa ser inteiro em centavos (ADR-0005).' })
  @Min(0)
  @Max(TETO_UNITARIO_CENTS)
  pricePerKwhCents!: number;

  @ApiPropertyOptional({ description: 'Taxa fixa por recarga, em CENTAVOS.', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(TETO_SESSAO_CENTS)
  connectionFeeCents?: number;

  @ApiPropertyOptional({ description: 'Preço por minuto CARREGANDO, em CENTAVOS.', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(TETO_UNITARIO_CENTS)
  pricePerMinuteCents?: number;

  @ApiPropertyOptional({
    description:
      'Preço por minuto de OCIOSIDADE — veículo plugado sem carregar. Sai do tempo cobrado ' +
      'como recarga, não soma por cima.',
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(TETO_UNITARIO_CENTS)
  idleFeePerMinuteCents?: number;

  @ApiPropertyOptional({ description: 'Valor mínimo da recarga, em CENTAVOS.', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(TETO_SESSAO_CENTS)
  minimumAmountCents?: number;

  @ApiPropertyOptional({
    description:
      'Teto COMERCIAL da recarga, em CENTAVOS. Diferente do teto de pré-autorização, ' +
      'que é limite financeiro. O teto efetivo é o menor dos dois (ADR-0008 §9).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(TETO_SESSAO_CENTS)
  maximumAmountCents?: number;

  @ApiPropertyOptional({ description: 'Início da validade. Omitido, vale desde agora.' })
  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @ApiPropertyOptional({ description: 'Fim da validade. Omitido, não expira.' })
  @IsOptional()
  @IsDateString()
  validUntil?: string;
}

/**
 * Edição.
 *
 * Todos os campos opcionais, e `siteId` fora: mudar a tarifa de estabelecimento
 * transformaria silenciosamente o preço de outro lugar. Para isso, cria-se
 * outra tarifa.
 */
export class UpdateTariffDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(TETO_UNITARIO_CENTS)
  pricePerKwhCents?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(TETO_SESSAO_CENTS)
  connectionFeeCents?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(TETO_UNITARIO_CENTS)
  pricePerMinuteCents?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(TETO_UNITARIO_CENTS)
  idleFeePerMinuteCents?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(TETO_SESSAO_CENTS)
  minimumAmountCents?: number;

  @ApiPropertyOptional({ description: 'Envie null para remover o teto comercial.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(TETO_SESSAO_CENTS)
  maximumAmountCents?: number | null;

  @ApiPropertyOptional() @IsOptional() @IsDateString() validFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() validUntil?: string | null;

  @ApiPropertyOptional({ description: 'false desativa a tarifa sem apagá-la.' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ListTariffsQueryDto extends PaginationDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() siteId?: string;

  @ApiPropertyOptional({ description: 'Inclui as tarifas desativadas.' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeInactive?: boolean;
}

/** Entrada da simulação de preço, para o operador conferir antes de publicar. */
export class SimulateTariffDto {
  @ApiProperty({ description: 'Energia entregue, em Wh inteiros.', example: 28350 })
  @Type(() => Number)
  @IsInt({ message: 'energyWh precisa ser um inteiro em Wh (ADR-0005).' })
  @Min(0)
  energyWh!: number;

  @ApiProperty({ description: 'Duração total, em segundos.', example: 1800 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  durationSeconds!: number;

  @ApiPropertyOptional({ description: 'Parte da duração em que o veículo não carregou.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  idleSeconds?: number;

  @ApiPropertyOptional({ description: 'Teto financeiro a considerar, em CENTAVOS.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(TETO_SESSAO_CENTS)
  ceilingAmountCents?: number;
}
