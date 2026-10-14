import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { TERMINAL_REQUEST_KEY, type TerminalIdentity } from './terminal.guard';

/** Terminal autenticado pelo `TerminalGuard`. */
export const CurrentTerminal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): TerminalIdentity =>
    context.switchToHttp().getRequest<Record<string, TerminalIdentity>>()[TERMINAL_REQUEST_KEY],
);
