import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateConnectorDto {
  @ApiProperty({
    example: 1,
    description: 'Numeração do OCPP. O conector 0 é o carregador inteiro.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(64)
  connectorNumber!: number;

  @ApiPropertyOptional({ example: 'CCS2' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  connectorType?: string;

  @ApiPropertyOptional({ example: 30, description: 'Potência nominal em kW.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1000)
  ratedPowerKw?: number;
}

export class UpdateConnectorDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) connectorType?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1000)
  ratedPowerKw?: number;
}

export class CreateChargerDto {
  @ApiProperty() @IsUUID() siteId!: string;

  @ApiProperty({
    example: 'WEMOB-001',
    description:
      'Charge Point Identity usado na URL OCPP. Precisa ser exatamente o valor configurado no equipamento.',
  })
  @IsString()
  @Length(1, 60)
  // Restrito ao que passa em URL sem escapar: firmwares lidam mal com o resto.
  @Matches(/^[A-Za-z0-9._:-]+$/, {
    message: 'A identity aceita apenas letras, números, ponto, hífen, sublinhado e dois-pontos.',
  })
  chargePointIdentity!: string;

  @ApiProperty({ example: 'Carregador da entrada' })
  @IsString()
  @Length(2, 120)
  name!: string;

  @ApiPropertyOptional({ example: 'WEG' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  manufacturer?: string;
  @ApiPropertyOptional({ example: 'WEMOB Station' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  model?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) serialNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) address?: string;

  @ApiPropertyOptional({
    description:
      'Teto de pré-autorização em CENTAVOS (ADR-0008 §9). Nulo herda do estabelecimento.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'O teto precisa ser um valor inteiro em centavos (ADR-0005).' })
  @Min(0)
  preAuthCeilingCents?: number;

  @ApiPropertyOptional({
    default: false,
    description:
      'Gera a credencial individual do carregador. Ela é devolvida UMA ÚNICA VEZ nesta resposta.',
  })
  @IsOptional()
  @IsBoolean()
  generateCredential?: boolean;

  @ApiPropertyOptional({ type: [CreateConnectorDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateConnectorDto)
  connectors?: CreateConnectorDto[];
}

export class UpdateChargerDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) manufacturer?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) model?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) serialNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  preAuthCeilingCents?: number;
}

export class SetOperationalStatusDto {
  @ApiProperty({ enum: ['AVAILABLE', 'BLOCKED', 'MAINTENANCE'] })
  @IsIn(['AVAILABLE', 'BLOCKED', 'MAINTENANCE'])
  status!: 'AVAILABLE' | 'BLOCKED' | 'MAINTENANCE';

  @ApiPropertyOptional({ description: 'Motivo, registrado na auditoria.' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

/**
 * Herda a paginação em vez de ser um segundo @Query() no controller.
 *
 * Com dois @Query() no mesmo endpoint, cada DTO valida a query INTEIRA de forma
 * independente — e `forbidNonWhitelisted` rejeita os campos que pertencem ao
 * outro. `?pageSize=50` derrubava a listagem com 400. Um DTO por endpoint
 * resolve na origem.
 */
export class ListChargersQueryDto extends PaginationDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() siteId?: string;

  @ApiPropertyOptional({ description: 'Lista apenas carregadores conectados.' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  onlineOnly?: boolean;
}

export class ListMessagesQueryDto extends PaginationDto {
  @ApiPropertyOptional({ example: 'MeterValues' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  action?: string;

  @ApiPropertyOptional({ enum: ['INBOUND', 'OUTBOUND'] })
  @IsOptional()
  @IsIn(['INBOUND', 'OUTBOUND'])
  direction?: 'INBOUND' | 'OUTBOUND';

  @ApiPropertyOptional({ description: 'Mostra apenas mensagens com erro.' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  onlyErrors?: boolean;
}
