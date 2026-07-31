import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

const ENTITY_STATUS = ['ACTIVE', 'INACTIVE'] as const;

export type TerminalEntityStatus = (typeof ENTITY_STATUS)[number];

/**
 * Faixa aceita para o código de pareamento.
 *
 * Hoje o painel gera 8 caracteres; a faixa é um pouco mais larga para que mudar
 * o tamanho no servidor não exija atualizar o aplicativo de toda maquininha
 * instalada em campo.
 */
const CODIGO_MIN = 6;
const CODIGO_MAX = 12;

/**
 * R$ 10.000,00 — barreira contra a maquininha mandar reais no lugar de centavos.
 *
 * Não é o teto comercial: esse é resolvido no servidor, pela hierarquia do
 * ADR-0008 §9, e é bem menor. Este limite existe só para que um erro de unidade
 * no aplicativo do terminal seja recusado na porta.
 */
const TETO_AUTORIZACAO_CENTS = 1_000_000;

// -----------------------------------------------------------------------------
// Painel
// -----------------------------------------------------------------------------

export class CreateTerminalDto {
  @ApiProperty({ example: 'Maquininha do poste 1' })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiProperty({
    description:
      'Conector em que o terminal está fisicamente montado. Obrigatório: é ele que ' +
      'define qual carregador a maquininha liga.',
  })
  @IsUUID()
  connectorId!: string;

  @ApiPropertyOptional({ example: 'PagBank Moderninha Smart 2' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string;
}

export class UpdateTerminalDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string;

  @ApiPropertyOptional({ description: 'Move a maquininha para outro conector.' })
  @IsOptional()
  @IsUUID()
  connectorId?: string;

  @ApiPropertyOptional({ enum: ENTITY_STATUS })
  @IsOptional()
  @IsIn(ENTITY_STATUS)
  status?: (typeof ENTITY_STATUS)[number];
}

export class ListTerminalsQueryDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  siteId?: string;

  @ApiPropertyOptional({ enum: ENTITY_STATUS })
  @IsOptional()
  @IsIn(ENTITY_STATUS)
  status?: (typeof ENTITY_STATUS)[number];
}

// -----------------------------------------------------------------------------
// Maquininha
// -----------------------------------------------------------------------------

export class PairTerminalDto {
  @ApiProperty({ description: 'Código de 8 caracteres gerado no painel.', example: 'K7M2QP4X' })
  @IsString()
  @Length(CODIGO_MIN, CODIGO_MAX)
  @Matches(/^[A-Za-z0-9]+$/, { message: 'O código tem apenas letras e números.' })
  pairingCode!: string;

  @ApiPropertyOptional({ description: 'Número de série do equipamento.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  serialNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string;

  @ApiPropertyOptional({ description: 'Versão do aplicativo instalado na maquininha.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  appVersion?: string;
}

/**
 * Resultado da pré-autorização feita **no equipamento**, pelo SDK do fabricante.
 *
 * O que este DTO **não aceita**, deliberadamente:
 *
 * - `connectorId` — vem do cadastro do terminal. Aceitá-lo aqui permitiria que
 *   um token furtado (risco R-32) iniciasse recarga em qualquer conector da
 *   plataforma, inclusive de outro estabelecimento.
 * - `provider` — vem da configuração do servidor. Aceitá-lo permitiria escolher
 *   um provedor simulado e carregar de graça, com o sistema registrando
 *   "pagamento aprovado".
 * - número completo do cartão, CVV ou trilha — nunca, em nenhuma hipótese
 *   (briefing seção 12). Só os quatro últimos dígitos.
 */
export class TerminalAuthorizationDto {
  @ApiProperty({ description: 'Identificador da cobrança gerado pelo terminal/adquirente.' })
  @IsString()
  @MaxLength(120)
  providerPaymentId!: string;

  @ApiProperty({ enum: ['CREDIT_CARD', 'DEBIT_CARD'] })
  @IsIn(['CREDIT_CARD', 'DEBIT_CARD'])
  method!: 'CREDIT_CARD' | 'DEBIT_CARD';

  @ApiProperty({
    description: 'Valor RESERVADO no cartão, em CENTAVOS inteiros (ADR-0005). R$ 200,00 = 20000.',
    example: 20000,
  })
  @Type(() => Number)
  @IsInt({ message: 'amountAuthorizedCents precisa ser inteiro em centavos (ADR-0005).' })
  @Min(1)
  @Max(TETO_AUTORIZACAO_CENTS)
  amountAuthorizedCents!: number;

  @ApiProperty({
    description:
      'Chave de idempotência gerada pelo terminal. Reenviar a mesma chave devolve ' +
      'o mesmo pagamento, nunca cria outro (regra 11.3).',
  })
  @IsString()
  @Length(8, 120)
  idempotencyKey!: string;

  @ApiPropertyOptional({ example: 'VISA' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  cardBrand?: string;

  @ApiPropertyOptional({
    description: 'APENAS os quatro últimos dígitos. Nunca o número completo (briefing seção 12).',
    example: '1234',
  })
  @IsOptional()
  @IsString()
  @Length(4, 4)
  @Matches(/^\d{4}$/, { message: 'cardLastFour são exatamente quatro dígitos.' })
  cardLastFour?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  nsu?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  authorizationCode?: string;
}

export class TerminalHeartbeatDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  appVersion?: string;
}

export class TerminalStopSessionDto {
  @ApiPropertyOptional({ description: 'Motivo mostrado ao operador.', example: 'motorista encerrou' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
