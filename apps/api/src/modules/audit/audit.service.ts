import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@bora/database';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

/**
 * Registro de auditoria das operações manuais (briefing seção 12).
 *
 * Toda ação que muda estado por decisão de uma pessoa é registrada: quem, o quê,
 * quando, de onde, e o valor antes e depois. Sem isso não há como responder
 * "quem parou aquela recarga?" — pergunta que aparece no primeiro incidente.
 *
 * Falha de auditoria nunca derruba a operação. Perder um registro é ruim;
 * impedir o operador de encerrar uma recarga travada é pior.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: {
    /**
     * Quem agiu. Opcional porque nem toda ação auditável parte de uma pessoa:
     * o pareamento de uma maquininha (FASE 8) é feito pelo próprio equipamento,
     * que não é usuário. Deixar esses eventos de fora da auditoria seria pior —
     * é exatamente a emissão de uma credencial que precisa ficar registrada.
     */
    user?: AuthenticatedUser;
    action: string;
    entityType: string;
    entityId?: string;
    organizationId?: string | null;
    previousValue?: unknown;
    newValue?: unknown;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          organizationId: input.organizationId ?? input.user?.organizationId,
          userId: input.user?.id,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          previousValue: (input.previousValue ?? undefined) as Prisma.InputJsonValue | undefined,
          newValue: (input.newValue ?? undefined) as Prisma.InputJsonValue | undefined,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent?.slice(0, 500),
        },
      });
    } catch (error) {
      this.logger.error(
        { err: error, action: input.action, entityType: input.entityType },
        'falha ao registrar auditoria — operação não foi interrompida',
      );
    }
  }
}
