import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { roleAtLeast, ROLE_LABELS, type UserRole } from '@bora/contracts';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../strategies/jwt.strategy';

/** Controle de acesso por papel, com hierarquia (SUPER_ADMIN > ... > VIEWER). */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required) return true;

    const user = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
    if (!user) return false;

    if (!roleAtLeast(user.role, required)) {
      throw new ForbiddenException({
        code: 'INSUFFICIENT_ROLE',
        message: `Esta ação exige o perfil "${ROLE_LABELS[required]}" ou superior.`,
      });
    }

    return true;
  }
}
