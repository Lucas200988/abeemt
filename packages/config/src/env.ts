import { z } from 'zod';

/**
 * Validação da configuração de ambiente.
 *
 * A regra é falhar no boot, com mensagem clara, e nunca deixar o processo subir
 * com configuração incompleta. Descobrir que `JWT_SECRET` estava vazio quando o
 * primeiro usuário tenta entrar é bem pior do que não subir.
 */

const PLACEHOLDER_PATTERN = /CHANGE_ME|TROQUE_ESTA_SENHA/i;

/** Aceita "true"/"false"/"1"/"0" — variáveis de ambiente são sempre string. */
const booleanFromString = z
  .string()
  .transform((v) => v.toLowerCase())
  .pipe(z.enum(['true', 'false', '1', '0']))
  .transform((v) => v === 'true' || v === '1');

const port = z.coerce.number().int().min(1).max(65535);

/** Percentual usado como limiar de parada automática (ADR-0008 §4, ADR-0010 §3). */
const percent = z.coerce.number().int().min(1).max(100);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    // Marca (ADR-0007)
    BORA_BRAND_NAME: z.string().min(1).default('Borá Carregar'),
    BORA_BRAND_SHORT: z.string().min(1).default('Borá'),

    // Banco
    DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),
    DATABASE_URL_TEST: z.string().optional(),

    // API
    API_PORT: port.default(3001),
    /**
     * Porta do painel. A API precisa conhecê-la para liberar o CORS em
     * desenvolvimento — ver `corsOrigins`.
     */
    WEB_PORT: port.default(3000),
    API_PREFIX: z.string().default('api'),
    SWAGGER_ENABLED: booleanFromString.default(true),
    CORS_ORIGINS: z.string().default('http://localhost:3000'),

    // Autenticação
    JWT_SECRET: z.string().min(16, 'JWT_SECRET precisa ter ao menos 16 caracteres'),
    JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET precisa ter ao menos 16 caracteres'),
    JWT_ACCESS_TTL: z.string().default('15m'),
    JWT_REFRESH_TTL: z.string().default('7d'),

    SEED_ADMIN_EMAIL: z.email().default('admin@sonare.com.br'),
    SEED_ADMIN_PASSWORD: z.string().min(8).optional(),

    // Rate limiting
    RATE_LIMIT_TTL_SECONDS: z.coerce.number().int().positive().default(60),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
    RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(10),

    // Regras comerciais (ADR-0005: dinheiro sempre em centavos inteiros)
    BORA_PREAUTH_CEILING_CENTS: z.coerce.number().int().positive().default(20000),
    BORA_AUTOSTOP_THRESHOLD_CARD_PCT: percent.default(95),
    BORA_AUTOSTOP_THRESHOLD_PIX_PCT: percent.default(100),

    // Pagamento
    /// Provedor usado para novos pagamentos. Em produção, um provedor simulado
    /// é recusado no boot (ver PaymentProviderRegistry).
    BORA_PAYMENT_PROVIDER: z.string().min(1).default('mock'),
    /**
     * Provedor usado pelas maquininhas (FASE 8).
     *
     * Separado do anterior porque são coisas diferentes: o painel pode operar
     * com um gateway `initiatedBy: 'backend'` enquanto o terminal usa o SDK do
     * fabricante, que é `initiatedBy: 'terminal'`.
     *
     * **A maquininha nunca informa o provedor.** Se informasse, um token de
     * terminal furtado (risco R-32) escolheria um provedor simulado e teria
     * recarga de graça, com o sistema registrando "pagamento aprovado". Quem
     * decide é esta variável, no servidor.
     */
    BORA_TERMINAL_PAYMENT_PROVIDER: z.string().min(1).default('terminal-mock'),
    /**
     * Validade do código de pareamento da maquininha, em minutos.
     *
     * Curta de propósito: o código é um portador — quem o tiver vira terminal
     * daquele conector. O ciclo previsto é gerar no painel e digitar no
     * equipamento, que leva minutos, não horas.
     */
    BORA_TERMINAL_PAIRING_TTL_MINUTES: z.coerce.number().int().positive().default(15),
    /**
     * Prazo, em segundos, para o carregador aceitar o comando de início
     * (regra 11.5). Estourado, a reserva é cancelada e nada é cobrado.
     */
    BORA_CHARGER_ACCEPT_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(120),
    /**
     * Prazo, em segundos, para o veículo efetivamente começar a carregar depois
     * do comando aceito (regra 11.5). Maior que o anterior: o carro pode estar
     * negociando com o carregador.
     */
    BORA_VEHICLE_START_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(300),
    /** Intervalo do worker que fecha sessões e captura valores, em segundos. */
    BORA_SETTLEMENT_INTERVAL_SECONDS: z.coerce.number().int().positive().default(15),

    // Adquirente real (FASE 7). Vazio = adapter não registrado.
    BORA_PAGBANK_BASE_URL: z.string().optional(),
    BORA_PAGBANK_TOKEN: z.string().optional(),
    BORA_PAGBANK_WEBHOOK_SECRET: z.string().optional(),
    /**
     * Só `true` depois de o adapter ter sido exercitado contra o sandbox e a
     * suíte de conformidade ter passado. Enquanto for falso, o adapter recusa
     * qualquer operação — ver `docs/payments/fase-7-o-que-falta.md`.
     */
    BORA_PAGBANK_VERIFIED: booleanFromString.default(false),

    /**
     * Rede/e.Rede (FASE 7 — fornecedor mais provável desde 2026-07-31).
     * Vazio = adapter não registrado.
     *
     * PV e chave de integração vêm do card do projeto no Portal do
     * Desenvolvedor (sandbox) ou do portal Use Rede (produção). O PV vira
     * `clientId` e a chave vira `clientSecret` no OAuth 2.0.
     */
    BORA_REDE_PV: z.string().optional(),
    BORA_REDE_INTEGRATION_KEY: z.string().optional(),
    /** Raiz da API transacional. Vazio = sandbox oficial. */
    BORA_REDE_BASE_URL: z.string().optional(),
    /** Raiz do serviço de token OAuth. Vazio = sandbox oficial. */
    BORA_REDE_OAUTH_URL: z.string().optional(),
    /**
     * Token fixo registrado no portal para a URL de notificação. A Rede não
     * assina o corpo do webhook — este token é a única autenticação dele.
     */
    BORA_REDE_WEBHOOK_TOKEN: z.string().optional(),
    /**
     * Só `true` depois de a suíte de conformidade passar contra o sandbox.
     * O manual foi lido na íntegra (v1.38), mas manual lido ≠ sandbox
     * exercitado — ver `docs/payments/rede-e-rede-contrato.md`.
     */
    BORA_REDE_VERIFIED: booleanFromString.default(false),
  })
  .superRefine((env, ctx) => {
    // Os dois segredos não podem ser iguais: um token de refresh assinado com a
    // mesma chave do access token pode ser aceito no lugar dele.
    if (env.JWT_SECRET === env.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_REFRESH_SECRET'],
        message: 'JWT_REFRESH_SECRET precisa ser diferente de JWT_SECRET',
      });
    }

    if (env.NODE_ENV !== 'production') return;

    // Em produção, placeholders do .env.example são erro fatal (risco R-20).
    const secrets = [
      'JWT_SECRET',
      'JWT_REFRESH_SECRET',
      'DATABASE_URL',
      'SEED_ADMIN_PASSWORD',
    ] as const;
    for (const key of secrets) {
      const value = env[key];
      if (typeof value === 'string' && PLACEHOLDER_PATTERN.test(value)) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} ainda contém um valor de exemplo. Gere um segredo real antes de subir em produção.`,
        });
      }
    }

    if (env.CORS_ORIGINS.trim() === '*') {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: 'CORS_ORIGINS não pode ser "*" em produção. Liste os domínios do painel.',
      });
    }

    if (env.SWAGGER_ENABLED) {
      ctx.addIssue({
        code: 'custom',
        path: ['SWAGGER_ENABLED'],
        message:
          'SWAGGER_ENABLED deve ser false em produção — a documentação expõe toda a superfície da API.',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Valida um objeto de ambiente e devolve a configuração tipada.
 * Lança com todas as falhas de uma vez — não uma por execução.
 */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `Configuração de ambiente inválida:\n${problems}\n\n` +
        'Confira o arquivo .env (use .env.example como referência).',
    );
  }

  return result.data;
}

/**
 * Origens de CORS já separadas, para uso direto.
 *
 * **Fora de produção**, o endereço local do painel é incluído automaticamente.
 * Sem isso, trocar `WEB_PORT` porque a 3000 estava ocupada quebrava o login de
 * um jeito que não parecia CORS: o navegador bloqueia a chamada antes de sair, e
 * o painel só consegue dizer "não foi possível conectar ao servidor" — enquanto
 * a API responde normalmente se testada direto. Aconteceu numa instalação real
 * em 2026-07-31 e custou várias tentativas até alguém desconfiar do CORS.
 *
 * Em produção não há mágica: vale exatamente a lista configurada, porque liberar
 * origem por conveniência é como se abre a porta que não devia.
 */
export function corsOrigins(env: Env): string[] {
  const configuradas = env.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  if (env.NODE_ENV === 'production') return configuradas;

  const painelLocal = [
    `http://localhost:${env.WEB_PORT}`,
    `http://127.0.0.1:${env.WEB_PORT}`,
  ].filter((origem) => !configuradas.includes(origem));

  return [...configuradas, ...painelLocal];
}
