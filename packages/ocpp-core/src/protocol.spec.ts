import { describe, expect, it } from 'vitest';
import {
  MessageType,
  OcppErrorCode,
  OcppParseError,
  parseMessage,
  serializeCall,
  serializeCallError,
  serializeCallResult,
} from './protocol';

describe('parseMessage — CALL', () => {
  it('interpreta um BootNotification bem formado', () => {
    const raw = JSON.stringify([
      2,
      'msg-1',
      'BootNotification',
      { chargePointVendor: 'WEG', chargePointModel: 'WEMOB Station' },
    ]);

    const message = parseMessage(raw);

    expect(message).toEqual({
      type: MessageType.CALL,
      messageId: 'msg-1',
      action: 'BootNotification',
      payload: { chargePointVendor: 'WEG', chargePointModel: 'WEMOB Station' },
    });
  });

  /**
   * Firmwares divergem entre mandar `{}` e omitir o payload de ações vazias
   * como Heartbeat. Recusar a segunda forma quebraria o carregador sem motivo.
   */
  it('aceita payload omitido como objeto vazio', () => {
    const message = parseMessage(JSON.stringify([2, 'msg-2', 'Heartbeat']));

    expect(message.type).toBe(MessageType.CALL);
    expect((message as { payload: unknown }).payload).toEqual({});
  });

  it('recusa action ausente', () => {
    expect(() => parseMessage(JSON.stringify([2, 'msg-3', null, {}]))).toThrow(OcppParseError);
  });

  it('recusa payload que não é objeto', () => {
    expect(() => parseMessage(JSON.stringify([2, 'msg-4', 'Heartbeat', 'texto']))).toThrow(
      /precisa ser um objeto/,
    );
  });

  it('recusa payload em array', () => {
    expect(() => parseMessage(JSON.stringify([2, 'msg-5', 'Heartbeat', []]))).toThrow(
      /precisa ser um objeto/,
    );
  });
});

describe('parseMessage — CALLRESULT', () => {
  it('interpreta a resposta de um RemoteStartTransaction', () => {
    const message = parseMessage(JSON.stringify([3, 'msg-10', { status: 'Accepted' }]));

    expect(message).toEqual({
      type: MessageType.CALLRESULT,
      messageId: 'msg-10',
      payload: { status: 'Accepted' },
    });
  });
});

describe('parseMessage — CALLERROR', () => {
  it('interpreta erro completo', () => {
    const message = parseMessage(
      JSON.stringify([4, 'msg-20', 'NotSupported', 'Ação não suportada', { detalhe: 'x' }]),
    );

    expect(message).toEqual({
      type: MessageType.CALLERROR,
      messageId: 'msg-20',
      errorCode: 'NotSupported',
      errorDescription: 'Ação não suportada',
      errorDetails: { detalhe: 'x' },
    });
  });

  it('tolera descrição e detalhes ausentes', () => {
    const message = parseMessage(JSON.stringify([4, 'msg-21', 'InternalError'])) as {
      errorDescription: string;
      errorDetails: unknown;
    };

    expect(message.errorDescription).toBe('');
    expect(message.errorDetails).toEqual({});
  });
});

describe('parseMessage — mensagens inválidas (seção 16 do briefing)', () => {
  it('JSON inválido devolve FormationViolation', () => {
    try {
      parseMessage('{isso não é json');
      expect.unreachable('deveria ter lançado');
    } catch (error) {
      expect(error).toBeInstanceOf(OcppParseError);
      expect((error as OcppParseError).errorCode).toBe(OcppErrorCode.FormationViolation);
      // Sem messageId legível não há como responder ao carregador.
      expect((error as OcppParseError).messageId).toBeNull();
    }
  });

  it('mensagem que não é array devolve ProtocolError', () => {
    try {
      parseMessage(JSON.stringify({ action: 'Heartbeat' }));
      expect.unreachable('deveria ter lançado');
    } catch (error) {
      expect((error as OcppParseError).errorCode).toBe(OcppErrorCode.ProtocolError);
    }
  });

  it('array curto demais é recusado', () => {
    expect(() => parseMessage(JSON.stringify([2, 'msg-30']))).toThrow(/ao menos 3 elementos/);
  });

  it('tipo de mensagem desconhecido é recusado, preservando o messageId', () => {
    try {
      parseMessage(JSON.stringify([9, 'msg-31', 'Heartbeat', {}]));
      expect.unreachable('deveria ter lançado');
    } catch (error) {
      const parseError = error as OcppParseError;
      expect(parseError.errorCode).toBe(OcppErrorCode.ProtocolError);
      // Com o id conhecido, conseguimos devolver uma CALLERROR correlacionada.
      expect(parseError.messageId).toBe('msg-31');
    }
  });

  it('messageId não textual é recusado', () => {
    expect(() => parseMessage(JSON.stringify([2, 123, 'Heartbeat', {}]))).toThrow(
      /messageId ausente/,
    );
  });

  it('messageId vazio é recusado', () => {
    expect(() => parseMessage(JSON.stringify([2, '', 'Heartbeat', {}]))).toThrow(/entre 1 e 36/);
  });

  it('messageId acima de 36 caracteres é recusado, e o id é truncado na resposta', () => {
    const longo = 'x'.repeat(40);

    try {
      parseMessage(JSON.stringify([2, longo, 'Heartbeat', {}]));
      expect.unreachable('deveria ter lançado');
    } catch (error) {
      expect((error as OcppParseError).messageId).toHaveLength(36);
    }
  });

  it('array vazio é recusado', () => {
    expect(() => parseMessage('[]')).toThrow(/ao menos 3 elementos/);
  });
});

describe('serialização', () => {
  it('serializa CALL no formato do protocolo', () => {
    const raw = serializeCall('msg-40', 'RemoteStartTransaction', { idTag: 'ABC', connectorId: 1 });

    expect(JSON.parse(raw)).toEqual([
      2,
      'msg-40',
      'RemoteStartTransaction',
      { idTag: 'ABC', connectorId: 1 },
    ]);
  });

  it('serializa CALLRESULT', () => {
    expect(JSON.parse(serializeCallResult('msg-41', { status: 'Accepted' }))).toEqual([
      3,
      'msg-41',
      { status: 'Accepted' },
    ]);
  });

  it('serializa CALLERROR com padrões seguros', () => {
    expect(JSON.parse(serializeCallError('msg-42', OcppErrorCode.NotImplemented))).toEqual([
      4,
      'msg-42',
      'NotImplemented',
      '',
      {},
    ]);
  });

  it('o que é serializado volta a ser interpretado igual', () => {
    const original = { chargePointVendor: 'WEG', chargePointModel: 'WEMOB' };
    const roundTrip = parseMessage(serializeCall('msg-43', 'BootNotification', original));

    expect((roundTrip as { payload: unknown }).payload).toEqual(original);
  });
});
