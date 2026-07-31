import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { TerminalsService } from './terminals.service';

/**
 * Identidade da maquininha vinda do próprio equipamento.
 *
 * O token é opaco e de portador, no cabeçalho `Authorization: Bearer`. Não é
 * JWT de propósito: um JWT vale até expirar, e o terminal fica pendurado num
 * poste — quando ele some, a revogação precisa ter efeito **agora**. Consultar
 * o banco a cada requisição é o preço disso, e é barato: a busca é por índice
 * único.
 */
export interface TerminalIdentity {
  id: string;
  name: string;
  siteId: string;
  organizationId: string;
  connectorId: string;
}

/** Onde a identidade é pendurada na requisição. */
export const TERMINAL_REQUEST_KEY = 'terminal';

@Injectable()
export class TerminalGuard implements CanActivate {
  constructor(private readonly terminals: TerminalsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.get('authorization') ?? '';
    const [esquema, token] = header.split(' ');

    if (esquema?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedException({
        code: 'MISSING_TERMINAL_TOKEN',
        message: 'Terminal não autorizado. Refaça o pareamento pelo painel.',
      });
    }

    const terminal = await this.terminals.authenticate(token);

    /**
     * `connectorId` é garantido pelo `authenticate`, que recusa terminal sem
     * conector. Repetir a checagem aqui é o que permite o tipo não ser nulo —
     * e todo o resto do módulo depender disso sem verificar de novo.
     */
    if (!terminal.connectorId) {
      throw new UnauthorizedException({
        code: 'TERMINAL_WITHOUT_CONNECTOR',
        message: 'Este terminal não está vinculado a nenhum conector.',
      });
    }

    const identidade: TerminalIdentity = {
      id: terminal.id,
      name: terminal.name,
      siteId: terminal.siteId,
      organizationId: terminal.site.organizationId,
      connectorId: terminal.connectorId,
    };

    (request as Request & Record<string, unknown>)[TERMINAL_REQUEST_KEY] = identidade;

    return true;
  }
}
