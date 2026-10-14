import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import type { Env } from '@bora/config';
import { ROLE_LABELS, type UserRole } from '@bora/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { ENV } from '../../config/config.module';
import { PasswordService } from './password.service';
import type { AuthResponseDto } from './dto/auth-response.dto';

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  organizationId: string | null;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly passwords: PasswordService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async login(
    email: string,
    password: string,
    context: { ipAddress?: string; userAgent?: string } = {},
  ): Promise<AuthResponseDto> {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });

    // Mensagem idêntica para usuário inexistente e senha errada: diferenciar
    // permitiria enumerar quais e-mails existem na plataforma.
    const invalid = new UnauthorizedException({
      code: 'INVALID_CREDENTIALS',
      message: 'E-mail ou senha incorretos.',
    });

    if (!user) {
      // Verificação falsa para não vazar a existência do usuário pelo tempo de
      // resposta — sem isso, e-mail inexistente responde bem mais rápido.
      await this.passwords.verify(
        '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAA',
        password,
      );
      throw invalid;
    }

    if (user.status !== 'ACTIVE') {
      this.logger.warn({ userId: user.id }, 'tentativa de login em conta inativa');
      throw new UnauthorizedException({
        code: 'USER_INACTIVE',
        message: 'Esta conta está inativa. Procure o administrador.',
      });
    }

    if (!(await this.passwords.verify(user.passwordHash, password))) {
      this.logger.warn({ userId: user.id }, 'senha incorreta');
      throw invalid;
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    this.logger.log({ userId: user.id, role: user.role }, 'login realizado');

    return this.issueTokens(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role as UserRole,
        organizationId: user.organizationId,
      },
      context,
    );
  }

  /**
   * Rotaciona o refresh token.
   *
   * O token antigo é revogado ao ser usado. Se um token já revogado aparecer, é
   * sinal de reuso — possivelmente token roubado — e todas as sessões do
   * usuário são derrubadas.
   */
  async refresh(
    refreshToken: string,
    context: { ipAddress?: string; userAgent?: string } = {},
  ): Promise<AuthResponseDto> {
    const invalid = new UnauthorizedException({
      code: 'INVALID_REFRESH_TOKEN',
      message: 'Sessão expirada. Entre novamente.',
    });

    try {
      await this.jwt.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.env.JWT_REFRESH_SECRET,
      });
    } catch {
      throw invalid;
    }

    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored) throw invalid;

    if (stored.revokedAt) {
      this.logger.error(
        { userId: stored.userId },
        'refresh token revogado foi reutilizado — derrubando todas as sessões do usuário',
      );
      await this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw invalid;
    }

    if (stored.expiresAt < new Date()) throw invalid;
    if (stored.user.status !== 'ACTIVE') throw invalid;

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(
      {
        id: stored.user.id,
        email: stored.user.email,
        name: stored.user.name,
        role: stored.user.role as UserRole,
        organizationId: stored.user.organizationId,
      },
      context,
    );
  }

  async logout(refreshToken: string): Promise<void> {
    // Sem erro se o token não existir: logout precisa ser idempotente.
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async logoutAll(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokens(
    user: {
      id: string;
      email: string;
      name: string;
      role: UserRole;
      organizationId: string | null;
    },
    context: { ipAddress?: string; userAgent?: string },
  ): Promise<AuthResponseDto> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
    };

    // expiresIn em segundos: o tipo do @nestjs/jwt aceita número, e assim não
    // dependemos do formato literal ("15m") ser reconhecido pelo pacote `ms`.
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.env.JWT_SECRET,
      expiresIn: this.ttlSeconds(this.env.JWT_ACCESS_TTL),
    });

    // jti aleatório para que dois refresh emitidos no mesmo segundo não colidam
    // no índice único de tokenHash.
    const refreshToken = await this.jwt.signAsync(
      { ...payload, jti: randomBytes(16).toString('hex') },
      {
        secret: this.env.JWT_REFRESH_SECRET,
        expiresIn: this.ttlSeconds(this.env.JWT_REFRESH_TTL),
      },
    );

    // Guardamos apenas o hash: um vazamento do banco não entrega tokens válidos.
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: this.expiryFromToken(refreshToken),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent?.slice(0, 255),
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.ttlSeconds(this.env.JWT_ACCESS_TTL),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        roleLabel: ROLE_LABELS[user.role],
        organizationId: user.organizationId,
      },
    };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private expiryFromToken(token: string): Date {
    const decoded = this.jwt.decode(token) as { exp?: number } | null;
    if (decoded?.exp) return new Date(decoded.exp * 1000);

    return new Date(Date.now() + this.ttlSeconds(this.env.JWT_REFRESH_TTL) * 1000);
  }

  /** Converte "15m"/"7d"/"3600" em segundos. */
  private ttlSeconds(ttl: string): number {
    const match = /^(\d+)([smhd])?$/.exec(ttl.trim());
    if (!match) return 900;

    const amount = Number(match[1]);
    const multiplier = { s: 1, m: 60, h: 3600, d: 86400 }[match[2] ?? 's'] ?? 1;

    return amount * multiplier;
  }
}
