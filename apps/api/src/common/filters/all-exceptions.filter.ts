import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Prisma } from '@bora/database';

/**
 * Formato único de erro da API.
 *
 * O painel é em português (briefing seção 14), então `message` é a frase que
 * pode ir direto para a tela. O detalhe técnico fica em `code` e `requestId`,
 * para a área de diagnóstico — não misturado na mensagem do usuário.
 */
export interface ErrorResponseBody {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
  timestamp: string;
  path: string;
}

/**
 * Captura tudo que escapa dos controllers.
 *
 * Duas responsabilidades que não podem ser negociadas:
 *  1. Nunca vazar stack trace, SQL ou detalhe interno na resposta.
 *  2. Sempre logar o erro real do lado do servidor — esconder erro é proibido
 *     pela regra 18.4 do briefing.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const requestId = (request as Request & { id?: string }).id;
    const resolved = this.resolve(exception);

    const body: ErrorResponseBody = {
      statusCode: resolved.status,
      code: resolved.code,
      message: resolved.message,
      ...(resolved.details !== undefined ? { details: resolved.details } : {}),
      ...(requestId ? { requestId } : {}),
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    // Erro do servidor é sempre logado com o objeto original; erro do cliente
    // fica em nível baixo para não poluir.
    if (resolved.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        { err: exception, requestId, path: request.url, method: request.method },
        resolved.message,
      );
    } else {
      this.logger.debug(
        { requestId, path: request.url, method: request.method, code: resolved.code },
        resolved.message,
      );
    }

    response.status(resolved.status).json(body);
  }

  private resolve(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details?: unknown;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      // O ThrottlerException traz "Too Many Requests" em inglês; o painel é
      // pt-BR (briefing seção 14).
      if (status === HttpStatus.TOO_MANY_REQUESTS) {
        return {
          status,
          code: 'RATE_LIMITED',
          message: 'Muitas tentativas em pouco tempo. Aguarde um instante e tente novamente.',
        };
      }

      if (typeof payload === 'string') {
        return { status, code: this.codeFromStatus(status), message: payload };
      }

      const record = payload as Record<string, unknown>;
      const rawMessage = record.message;

      // O class-validator devolve um array de mensagens. Isso identifica um
      // erro de validação com precisão maior do que só o status 400.
      const isValidation = Array.isArray(rawMessage);

      return {
        status,
        code:
          typeof record.code === 'string'
            ? record.code
            : isValidation
              ? 'VALIDATION_ERROR'
              : this.codeFromStatus(status),
        message: isValidation
          ? 'Dados inválidos na requisição.'
          : typeof rawMessage === 'string'
            ? rawMessage
            : exception.message,
        // As mensagens do validador viram detalhe técnico, não a frase da tela.
        ...(isValidation ? { details: rawMessage } : {}),
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.resolvePrisma(exception);
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        code: 'VALIDATION_ERROR',
        message: 'Dados inválidos na requisição.',
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      // Mensagem genérica de propósito: o detalhe está no log, não na resposta.
      message: 'Erro interno. A equipe técnica foi notificada.',
    };
  }

  /**
   * Traduz erros do Prisma para mensagens que fazem sentido em português.
   *
   * O P2002 merece atenção: é o índice único disparando. No nosso caso, é
   * exatamente o que impede sessão duplicada por conector e webhook duplicado
   * (regra 11.1 e risco R-08). A mensagem precisa ser compreensível.
   */
  private resolvePrisma(error: Prisma.PrismaClientKnownRequestError): {
    status: number;
    code: string;
    message: string;
    details?: unknown;
  } {
    switch (error.code) {
      case 'P2002': {
        const target = (error.meta?.target as string[] | string | undefined) ?? [];
        const fields = Array.isArray(target) ? target.join(', ') : String(target);

        // Índice parcial da regra 11.1 — vale uma mensagem específica.
        if (String(target).includes('one_active_per_connector')) {
          return {
            status: HttpStatus.CONFLICT,
            code: 'CONNECTOR_BUSY',
            message: 'Este conector já possui uma recarga em andamento.',
          };
        }

        return {
          status: HttpStatus.CONFLICT,
          code: 'DUPLICATE',
          message: 'Já existe um registro com estes dados.',
          details: fields ? { fields } : undefined,
        };
      }

      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          code: 'NOT_FOUND',
          message: 'Registro não encontrado.',
        };

      case 'P2003':
        return {
          status: HttpStatus.BAD_REQUEST,
          code: 'FOREIGN_KEY',
          message: 'Referência inválida: o registro relacionado não existe.',
        };

      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          code: 'DATABASE_ERROR',
          message: 'Erro ao acessar o banco de dados.',
        };
    }
  }

  private codeFromStatus(status: number): string {
    const map: Record<number, string> = {
      [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
      [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
      [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
      [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
      [HttpStatus.CONFLICT]: 'CONFLICT',
      [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
    };

    return map[status] ?? 'ERROR';
  }
}
