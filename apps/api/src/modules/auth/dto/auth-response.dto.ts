import { ApiProperty } from '@nestjs/swagger';
import { ROLE_LABELS, type UserRole } from '@bora/contracts';

export class AuthenticatedUserDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: Object.keys(ROLE_LABELS) }) role!: UserRole;
  @ApiProperty({ description: 'Rótulo do papel em português, para exibição.' })
  roleLabel!: string;
  @ApiProperty({ nullable: true }) organizationId!: string | null;
}

export class AuthResponseDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty() refreshToken!: string;
  @ApiProperty({ description: 'Validade do token de acesso, em segundos.' })
  expiresIn!: number;
  @ApiProperty({ type: AuthenticatedUserDto }) user!: AuthenticatedUserDto;
}
