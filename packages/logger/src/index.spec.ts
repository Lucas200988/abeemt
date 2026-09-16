import { describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import { createLogger, withContext } from './index';

/**
 * Coleta as linhas emitidas pelo logger REAL.
 *
 * Importante testar a instância que o resto do sistema usa, e não uma cópia
 * aproximada da configuração: é a lista de mascaramento de verdade que precisa
 * estar correta, não uma reescrita dela no teste.
 */
function captureLogs(level = 'info') {
  const lines: Record<string, unknown>[] = [];

  const destination = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(JSON.parse(chunk.toString()));
      callback();
    },
  });

  return { lines, logger: createLogger({ level, destination }) };
}

describe('createLogger', () => {
  it('emite JSON com nível textual e timestamp ISO', () => {
    const { lines, logger } = captureLogs();

    logger.info({ chargerId: 'chg_1' }, 'carregador conectado');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 'info',
      msg: 'carregador conectado',
      chargerId: 'chg_1',
    });
    expect(String(lines[0].time)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('respeita o nível configurado', () => {
    const { lines, logger } = captureLogs('warn');

    logger.info('não deve aparecer');
    logger.warn('deve aparecer');

    expect(lines).toHaveLength(1);
    expect(lines[0].msg).toBe('deve aparecer');
  });
});

describe('mascaramento de dados sensíveis', () => {
  it('redige senha, token e cabeçalho de autorização', () => {
    const { lines, logger } = captureLogs();

    logger.info(
      {
        password: 'senha-secreta',
        token: 'jwt-secreto',
        refreshToken: 'refresh-secreto',
        req: { headers: { authorization: 'Bearer abc123' } },
        body: { password: 'outra-senha' },
      },
      'tentativa de login',
    );

    const serialized = JSON.stringify(lines[0]);
    expect(serialized).not.toContain('senha-secreta');
    expect(serialized).not.toContain('jwt-secreto');
    expect(serialized).not.toContain('refresh-secreto');
    expect(serialized).not.toContain('Bearer abc123');
    expect(serialized).not.toContain('outra-senha');
    expect(lines[0].password).toBe('[REDIGIDO]');
  });

  it('redige o hash de senha e a credencial do carregador', () => {
    const { lines, logger } = captureLogs();

    logger.info({ passwordHash: '$argon2id$abc', credentialsHash: '$argon2id$xyz' }, 'usuário');

    expect(lines[0].passwordHash).toBe('[REDIGIDO]');
    expect(lines[0].credentialsHash).toBe('[REDIGIDO]');
  });

  /**
   * A plataforma não deve nem receber estes dados (briefing seção 12). Se um
   * payload de adquirente vier com eles por engano, o log não pode ser o lugar
   * onde acabam persistidos.
   */
  it('redige dados de cartão que nunca deveriam chegar até aqui', () => {
    const { lines, logger } = captureLogs();

    logger.info(
      {
        cardNumber: '4111111111111111',
        cvv: '123',
        track2: ';4111111111111111=25121011',
        cardPin: '1234',
        // Estes são permitidos pelo briefing (seção 4) e devem sobreviver.
        cardLastFour: '1111',
        cardBrand: 'VISA',
        nsu: '000123',
      },
      'pagamento aprovado',
    );

    const entry = lines[0];
    expect(entry.cardNumber).toBe('[REDIGIDO]');
    expect(entry.cvv).toBe('[REDIGIDO]');
    expect(entry.track2).toBe('[REDIGIDO]');
    expect(entry.cardPin).toBe('[REDIGIDO]');

    expect(entry.cardLastFour).toBe('1111');
    expect(entry.cardBrand).toBe('VISA');
    expect(entry.nsu).toBe('000123');
  });

  it('alcança campos aninhados dentro de payload e body', () => {
    const { lines, logger } = captureLogs();

    logger.info({ payload: { token: 'aninhado-secreto' } }, 'webhook recebido');

    expect(JSON.stringify(lines[0])).not.toContain('aninhado-secreto');
  });

  it('preserva os campos operacionais', () => {
    const { lines, logger } = captureLogs();

    logger.info({ password: 'x', chargerId: 'chg_1', energyWh: 28350 }, 'sessão encerrada');

    expect(lines[0]).toMatchObject({ chargerId: 'chg_1', energyWh: 28350 });
  });
});

describe('withContext', () => {
  it('anexa os campos de correlação a todos os logs do filho', () => {
    const { lines, logger } = captureLogs();

    const child = withContext(logger, {
      correlationId: 'corr_1',
      sessionId: 'ses_1',
      chargerId: 'chg_1',
      paymentId: 'pay_1',
    });

    child.info('comando enviado');
    child.info('comando aceito');

    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).toMatchObject({
        correlationId: 'corr_1',
        sessionId: 'ses_1',
        chargerId: 'chg_1',
        paymentId: 'pay_1',
      });
    }
  });

  it('descarta chaves indefinidas em vez de logar null', () => {
    const { lines, logger } = captureLogs();

    withContext(logger, { requestId: 'req_1', paymentId: undefined }).info('ok');

    expect(lines[0]).toHaveProperty('requestId', 'req_1');
    expect(lines[0]).not.toHaveProperty('paymentId');
  });
});
