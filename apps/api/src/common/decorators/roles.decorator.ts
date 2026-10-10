import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@bora/contracts';

export const ROLES_KEY = 'requiredRole';

/** Exige o papel informado ou superior na hierarquia. */
export const RequireRole = (role: UserRole) => SetMetadata(ROLES_KEY, role);
