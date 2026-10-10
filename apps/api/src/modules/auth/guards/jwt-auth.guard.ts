import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';

/**
 * Guard global. Toda rota exige autenticação por padrão; abrir uma rota é um
 * ato explícito com @Public().
 *
 * O padrão inverso — proteger caso a caso — falha por omissão, e a omissão
 * aqui significa endpoint aberto.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    return super.canActivate(context);
  }

  /**
   * Traduz a falha do Passport.
   *
   * O padrão devolve "Unauthorized" em inglês, e o painel é em pt-BR
   * (briefing seção 14). O motivo técnico vai em `code`, para a área de
   * diagnóstico; a mensagem é a que pode ir para a tela.
   */
  handleRequest<TUser>(err: unknown, user: TUser, info: unknown): TUser {
    // A estratégia pode ter recusado por um motivo específico (conta desativada,
    // por exemplo). Esse motivo é mais útil do que um "não autenticado"
    // genérico, então preservamos o erro original.
    if (err instanceof UnauthorizedException) throw err;

    if (err || !user) {
      const expired =
        typeof info === 'object' && info !== null && (info as Error).name === 'TokenExpiredError';

      throw new UnauthorizedException({
        code: expired ? 'TOKEN_EXPIRED' : 'UNAUTHENTICATED',
        message: expired
          ? 'Sua sessão expirou. Entre novamente.'
          : 'É necessário estar autenticado para acessar este recurso.',
      });
    }

    return user;
  }
}
