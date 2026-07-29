import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Env } from '@bora/config';
import type { UserRole } from '@bora/contracts';
import { ENV } from '../../../config/config.module';
import { PrismaService } from '../../../prisma/prisma.service';
import type { JwtPayload } from '../auth.service';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  organizationId: string | null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    @Inject(ENV) env: Env,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: env.JWT_SECRET,
    });
  }

  /**
   * Revalida o usuário no banco a cada requisição.
   *
   * Custa uma consulta, mas garante que desativar um usuário tem efeito
   * imediato. Confiar apenas no que está assinado no token significaria que um
   * usuário demitido continua entrando até o token expirar.
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true, role: true, organizationId: true, status: true },
    });

    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException({
        code: 'USER_INACTIVE',
        message: 'Sessão inválida. Entre novamente.',
      });
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as UserRole,
      organizationId: user.organizationId,
    };
  }
}
