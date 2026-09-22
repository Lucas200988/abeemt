import { describe, expect, it } from 'vitest';
import { corsOrigins, parseEnv } from './env';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

describe('parseEnv', () => {
  it('aplica os padrões documentados', () => {
    const env = parseEnv({ ...base } as NodeJS.ProcessEnv);

    expect(env.NODE_ENV).toBe('development');
    expect(env.API_PORT).toBe(3001);
    // ADR-0008 §9: teto padrão de R$ 200,00 em centavos inteiros.
    expect(env.BORA_PREAUTH_CEILING_CENTS).toBe(20000);
    // ADR-0010 §3: o limiar do Pix é mais alto que o do cartão, de propósito.
    expect(env.BORA_AUTOSTOP_THRESHOLD_CARD_PCT).toBe(95);
    expect(env.BORA_AUTOSTOP_THRESHOLD_PIX_PCT).toBe(100);
  });

  it('exige DATABASE_URL', () => {
    const { DATABASE_URL: _omitido, ...semBanco } = base;
    expect(() => parseEnv(semBanco as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/);
  });

  it('recusa segredo de JWT curto demais', () => {
    expect(() => parseEnv({ ...base, JWT_SECRET: 'curto' } as NodeJS.ProcessEnv)).toThrow(
      /ao menos 16 caracteres/,
    );
  });

  it('recusa segredos de access e refresh iguais', () => {
    const mesmo = 'c'.repeat(32);
    expect(() =>
      parseEnv({ ...base, JWT_SECRET: mesmo, JWT_REFRESH_SECRET: mesmo } as NodeJS.ProcessEnv),
    ).toThrow(/diferente de JWT_SECRET/);
  });

  it('acumula todos os erros em uma única mensagem', () => {
    try {
      parseEnv({ JWT_SECRET: 'x' } as NodeJS.ProcessEnv);
      expect.unreachable('deveria ter lançado');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('JWT_REFRESH_SECRET');
    }
  });

  describe('em produção', () => {
    const prod = { ...base, NODE_ENV: 'production', SWAGGER_ENABLED: 'false' };

    it('recusa placeholder deixado no .env', () => {
      expect(() =>
        parseEnv({ ...prod, JWT_SECRET: 'CHANGE_ME_gere_com_openssl' } as NodeJS.ProcessEnv),
      ).toThrow(/valor de exemplo/);
    });

    it('recusa CORS aberto', () => {
      expect(() => parseEnv({ ...prod, CORS_ORIGINS: '*' } as NodeJS.ProcessEnv)).toThrow(
        /não pode ser "\*"/,
      );
    });

    it('recusa Swagger habilitado', () => {
      expect(() => parseEnv({ ...prod, SWAGGER_ENABLED: 'true' } as NodeJS.ProcessEnv)).toThrow(
        /Swagger/i,
      );
    });

    it('aceita configuração completa e sem placeholders', () => {
      expect(() => parseEnv(prod as NodeJS.ProcessEnv)).not.toThrow();
    });
  });
});

describe('corsOrigins', () => {
  it('separa, apara espaços e descarta vazios', () => {
    const env = parseEnv({
      ...base,
      NODE_ENV: 'production',
      SWAGGER_ENABLED: 'false',
      CORS_ORIGINS: 'http://a.com, http://b.com ,,',
    } as NodeJS.ProcessEnv);

    expect(corsOrigins(env)).toEqual(['http://a.com', 'http://b.com']);
  });

  /**
   * O painel numa porta diferente da configurada em CORS_ORIGINS é o caminho
   * normal em desenvolvimento — basta a 3000 estar ocupada. Sem esta liberação,
   * o navegador bloqueia a chamada e o sintoma não parece CORS: o painel diz que
   * não conecta, enquanto a API responde bem se testada direto.
   */
  it('libera o painel local automaticamente fora de produção', () => {
    const env = parseEnv({ ...base, WEB_PORT: '3005' } as NodeJS.ProcessEnv);

    expect(corsOrigins(env)).toContain('http://localhost:3005');
    expect(corsOrigins(env)).toContain('http://127.0.0.1:3005');
    // A lista configurada continua valendo.
    expect(corsOrigins(env)).toContain('http://localhost:3000');
  });

  it('não duplica quando a origem já está configurada', () => {
    const env = parseEnv({
      ...base,
      WEB_PORT: '3000',
      CORS_ORIGINS: 'http://localhost:3000',
    } as NodeJS.ProcessEnv);

    expect(corsOrigins(env).filter((o) => o === 'http://localhost:3000')).toHaveLength(1);
  });

  /** Em produção não há liberação por conveniência. */
  it('em produção vale exatamente a lista configurada', () => {
    const env = parseEnv({
      ...base,
      NODE_ENV: 'production',
      SWAGGER_ENABLED: 'false',
      WEB_PORT: '3005',
      CORS_ORIGINS: 'https://painel.sonare.com.br',
    } as NodeJS.ProcessEnv);

    expect(corsOrigins(env)).toEqual(['https://painel.sonare.com.br']);
  });
});
