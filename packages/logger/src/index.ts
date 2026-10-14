import pino, { type Logger, type LoggerOptions } from 'pino';

export type { Logger };

/**
 * Campos que nunca podem aparecer no log.
 *
 * A lista existe porque mascarar depois de vazar não adianta. Inclui dados de
 * cartão que a plataforma não deve nem receber (seção 12 do briefing) — se
 * algum deles aparecer num payload, o log não é o lugar onde vamos descobrir.
 */
const REDACTED_PATHS = [
  'password',
  'senha',
  'currentPassword',
  'newPassword',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'cookie',
  'secret',
  'apiKey',
  'credentialsHash',
  // Dados de cartão — não armazenamos, e também não logamos.
  'cardNumber',
  'pan',
  'cvv',
  'cvc',
  'securityCode',
  'track1',
  'track2',
  'cardPin',
];

/** Gera os caminhos aninhados que o pino precisa para varrer objetos comuns. */
function redactionPaths(): string[] {
  const containers = ['req.body', 'req.headers', 'res.body', 'body', 'payload', 'data', 'raw'];
  const paths = [...REDACTED_PATHS];

  for (const container of containers) {
    for (const field of REDACTED_PATHS) {
      paths.push(`${container}.${field}`);
      paths.push(`${container}.*.${field}`);
    }
  }

  return [...new Set(paths)];
}

export interface CreateLoggerOptions {
  level?: string;
  /** Saída legível para humanos. Use apenas em desenvolvimento. */
  pretty?: boolean;
  name?: string;
  base?: Record<string, unknown>;
  /**
   * Destino alternativo da saída. Existe para que os testes verifiquem a
   * configuração real — inclusive a lista de mascaramento — em vez de uma
   * reconstrução aproximada dela.
   */
  destination?: pino.DestinationStream;
}

/**
 * Logger estruturado em JSON (seção 13 do briefing).
 *
 * Em produção a saída é JSON puro, para ser consumida por ferramenta de
 * observabilidade. Em desenvolvimento, `pretty` deixa legível no terminal.
 */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const { level = 'info', pretty = false, name, base, destination } = options;

  const config: LoggerOptions = {
    level,
    name,
    base: { ...base },
    redact: { paths: redactionPaths(), censor: '[REDIGIDO]' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
  };

  if (destination) {
    return pino(config, destination);
  }

  if (pretty) {
    return pino({
      ...config,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' },
      },
    });
  }

  return pino(config);
}

/**
 * Campos de correlação que atravessam o sistema (seção 13 do briefing).
 *
 * Todo log de uma operação deve carregar os que forem aplicáveis. É isso que
 * permite reconstruir uma sessão inteira a partir de um `correlationId`.
 */
export interface LogContext {
  requestId?: string;
  correlationId?: string;
  sessionId?: string;
  chargerId?: string;
  chargePointIdentity?: string;
  paymentId?: string;
  userId?: string;
  organizationId?: string;
}

/** Deriva um logger filho já com o contexto de correlação preenchido. */
export function withContext(logger: Logger, context: LogContext): Logger {
  const clean = Object.fromEntries(
    Object.entries(context).filter(([, value]) => value !== undefined && value !== null),
  );

  return logger.child(clean);
}
