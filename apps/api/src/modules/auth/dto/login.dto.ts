import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin@sonare.com.br' })
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  @MaxLength(255)
  email!: string;

  @ApiProperty({ example: 'sua-senha' })
  @IsString()
  @MinLength(8, { message: 'A senha precisa ter ao menos 8 caracteres.' })
  @MaxLength(128)
  password!: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  refreshToken!: string;
}
