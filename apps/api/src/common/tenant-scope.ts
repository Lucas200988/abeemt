import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '../modules/auth/strategies/jwt.strategy';

/**
 * Escopo por organização.
 *
 * A plataforma é multi-estabelecimento desde o modelo de dados. O maior risco
 * disso é um operador de um hotel ver as sessões — e a receita — de outro. Por
 * isso o escopo é aplicado no **serviço**, não no controller: um endpoint novo
 * que esqueça de filtrar não passa a vazar dados, porque o filtro está no
 * caminho da consulta.
 *
 * `SUPER_ADMIN` é o único papel sem organização própria e enxerga tudo.
 */

/** Filtro a aplicar em `where` de entidades que têm `organizationId`. */
export function organizationFilter(user: AuthenticatedUser): { organizationId?: string } {
  if (user.role === 'SUPER_ADMIN') return {};

  if (!user.organizationId) {
    // Papel não-global sem organização é dado inconsistente. Bloquear é a
    // resposta segura — o contrário significaria acesso irrestrito por acidente.
    throw new ForbiddenException({
      code: 'NO_ORGANIZATION',
      message: 'Seu usuário não está vinculado a nenhum estabelecimento.',
    });
  }

  return { organizationId: user.organizationId };
}

/**
 * Filtro para entidades que alcançam a organização por `site`
 * (carregadores, conectores, mensagens OCPP).
 */
export function siteScopedFilter(user: AuthenticatedUser): {
  site?: { organizationId: string };
} {
  if (user.role === 'SUPER_ADMIN') return {};

  if (!user.organizationId) {
    throw new ForbiddenException({
      code: 'NO_ORGANIZATION',
      message: 'Seu usuário não está vinculado a nenhum estabelecimento.',
    });
  }

  return { site: { organizationId: user.organizationId } };
}

/**
 * Verifica se o usuário pode agir sobre um recurso de determinada organização.
 *
 * Devolve 403 e não 404 quando o recurso existe mas é de outra organização —
 * a distinção é deliberada: para o usuário, "não encontrado" e "não é seu" são
 * respostas equivalentes, e usar 404 evitaria revelar a existência do recurso.
 * Aqui optamos por 403 porque o acesso é entre estabelecimentos de uma mesma
 * plataforma administrada, não entre estranhos.
 */
export function assertSameOrganization(user: AuthenticatedUser, organizationId: string): void {
  if (user.role === 'SUPER_ADMIN') return;

  if (user.organizationId !== organizationId) {
    throw new ForbiddenException({
      code: 'WRONG_ORGANIZATION',
      message: 'Este recurso pertence a outro estabelecimento.',
    });
  }
}

/**
 * Organização a usar ao criar um recurso.
 *
 * Um `ORG_ADMIN` só cria na sua própria organização, mesmo que informe outra no
 * corpo da requisição — confiar no que vem do cliente aqui permitiria criar
 * recursos no estabelecimento alheio.
 */
export function organizationForCreate(
  user: AuthenticatedUser,
  informada: string | undefined,
): string {
  if (user.role === 'SUPER_ADMIN') {
    if (!informada) {
      throw new ForbiddenException({
        code: 'ORGANIZATION_REQUIRED',
        message: 'Informe o estabelecimento (organizationId) ao criar como administrador global.',
      });
    }
    return informada;
  }

  if (!user.organizationId) {
    throw new ForbiddenException({
      code: 'NO_ORGANIZATION',
      message: 'Seu usuário não está vinculado a nenhum estabelecimento.',
    });
  }

  return user.organizationId;
}
