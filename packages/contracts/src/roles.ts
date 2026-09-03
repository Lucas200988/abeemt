/** Papéis de acesso. Espelha o enum UserRole do Prisma. */
export const USER_ROLES = ['SUPER_ADMIN', 'ORG_ADMIN', 'OPERATOR', 'VIEWER'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/**
 * Hierarquia de permissão. Número maior enxerga tudo que o menor enxerga.
 * Usada pelo guard de papéis da API.
 */
export const ROLE_LEVEL: Record<UserRole, number> = {
  VIEWER: 0,
  OPERATOR: 1,
  ORG_ADMIN: 2,
  SUPER_ADMIN: 3,
};

export function roleAtLeast(role: UserRole, minimum: UserRole): boolean {
  return ROLE_LEVEL[role] >= ROLE_LEVEL[minimum];
}

/** Rótulos em português para o painel (briefing seção 14). */
export const ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: 'Administrador global',
  ORG_ADMIN: 'Administrador do estabelecimento',
  OPERATOR: 'Operador',
  VIEWER: 'Visualizador',
};
