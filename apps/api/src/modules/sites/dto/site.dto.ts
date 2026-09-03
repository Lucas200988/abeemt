import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Min, MaxLength } from 'class-validator';

export class CreateSiteDto {
  @ApiProperty({ example: 'Hotel Beira Rio' })
  @IsString()
  @Length(2, 120)
  name!: string;

  @ApiPropertyOptional({
    description: 'Somente para administrador global. Os demais criam na própria organização.',
  })
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) legalName?: string;
  @ApiPropertyOptional({ description: 'CNPJ. Opcional no MVP.' })
  @IsOptional()
  @IsString()
  @MaxLength(18)
  taxId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) address?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) city?: string;
  @ApiPropertyOptional({ example: 'MT' })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  state?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10) postalCode?: string;

  @ApiPropertyOptional({ default: 'America/Cuiaba' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  timezone?: string;

  @ApiPropertyOptional({
    description:
      'Teto de pré-autorização em CENTAVOS, sobrescrevendo o da organização (ADR-0008 §9). Nulo herda.',
    example: 20000,
  })
  @IsOptional()
  @IsInt({ message: 'O teto precisa ser um valor inteiro em centavos (ADR-0005).' })
  @Min(0)
  preAuthCeilingCents?: number;
}

export class UpdateSiteDto extends CreateSiteDto {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 120)
  declare name: string;
}
