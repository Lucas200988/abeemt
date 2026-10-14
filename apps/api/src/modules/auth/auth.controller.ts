import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ROLE_LABELS } from '@bora/contracts';
import { runtimeEnv } from '../../config/runtime-env';
import { AuthService } from './auth.service';
import { LoginDto, RefreshDto } from './dto/login.dto';
import { AuthenticatedUserDto, AuthResponseDto } from './dto/auth-response.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from './strategies/jwt.strategy';

@ApiTags('Autenticação')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  // Limite apertado no login: é o alvo natural de força bruta.
  // O valor vem da configuração — cravá-lo aqui tornaria o limite impossível de
  // ajustar por ambiente.
  @Throttle({
    default: {
      limit: runtimeEnv.RATE_LIMIT_AUTH_MAX,
      ttl: runtimeEnv.RATE_LIMIT_TTL_SECONDS * 1000,
    },
  })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Autentica um usuário e devolve os tokens' })
  @ApiResponse({ status: 200, type: AuthResponseDto })
  @ApiResponse({ status: 401, description: 'E-mail ou senha incorretos' })
  login(@Body() dto: LoginDto, @Req() request: Request): Promise<AuthResponseDto> {
    return this.auth.login(dto.email, dto.password, {
      ipAddress: request.ip,
      userAgent: request.get('user-agent'),
    });
  }

  @Public()
  @Throttle({
    default: {
      limit: runtimeEnv.RATE_LIMIT_AUTH_MAX * 2,
      ttl: runtimeEnv.RATE_LIMIT_TTL_SECONDS * 1000,
    },
  })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Renova o token de acesso e rotaciona o refresh' })
  @ApiResponse({ status: 200, type: AuthResponseDto })
  refresh(@Body() dto: RefreshDto, @Req() request: Request): Promise<AuthResponseDto> {
    return this.auth.refresh(dto.refreshToken, {
      ipAddress: request.ip,
      userAgent: request.get('user-agent'),
    });
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoga o refresh token informado' })
  async logout(@Body() dto: RefreshDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }

  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'Dados do usuário autenticado' })
  @ApiResponse({ status: 200, type: AuthenticatedUserDto })
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUserDto {
    return { ...user, roleLabel: ROLE_LABELS[user.role] };
  }
}
