import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import {
  MessageType,
  OCPP_SUBPROTOCOL,
  parseMessage,
  serializeCall,
  serializeCallError,
  serializeCallResult,
  OcppErrorCode,
} from '@bora/ocpp-core';

/**
 * Simulador de carregador OCPP 1.6J.
 *
 * Existe por dois motivos, ambos do briefing (seção 9):
 *
 *  1. Desenvolver e testar sem depender do equipamento físico.
 *  2. Não tocar o WEMOB real antes de o fluxo estar provado (regra 18.2).
 *
 * Ele simula um carregador **de verdade**, incluindo os comportamentos chatos:
 * recusar comandos, cair no meio da recarga, mandar leitura fora de ordem. Um
 * simulador que só faz o caminho felizes não prova nada.
 */

export interface SimulatorOptions {
  url: string;
  chargePointIdentity: string;
  /** Credencial para Basic Auth, quando o carregador tiver uma cadastrada. */
  password?: string;
  vendor?: string;
  model?: string;
  firmwareVersion?: string;
  serialNumber?: string;
  connectors?: number;
  /** Potência simulada, usada para incrementar o medidor de forma realista. */
  powerKw?: number;
  heartbeatIntervalMs?: number;
  meterIntervalMs?: number;
  /** Leitura inicial do medidor, em Wh. Um carregador em uso já tem histórico. */
  initialMeterWh?: number;

  // --- Simulação de falhas (seção 9 do briefing) ---
  /** Recusa qualquer RemoteStartTransaction. */
  rejectRemoteStart?: boolean;
  /** Recusa qualquer RemoteStopTransaction. */
  rejectRemoteStop?: boolean;
  /** Responde CALLERROR em vez de CALLRESULT. */
  respondWithCallError?: boolean;
  /** Não responde nada — para exercitar o timeout do servidor. */
  goSilent?: boolean;
  /** Manda a mesma leitura duas vezes, fora de ordem. */
  sendOutOfOrderMeterValues?: boolean;
  /** Aceita o RemoteStart mas nunca envia StartTransaction (veículo não iniciou). */
  neverStartTransaction?: boolean;
  /** Unidade das leituras de energia. `kWh` exercita a normalização (risco R-11). */
  energyUnit?: 'Wh' | 'kWh';
  /** Reconecta sozinho ao perder a conexão, como um carregador real faz. */
  autoReconnect?: boolean;
  reconnectDelayMs?: number;
}

export type ConnectorState =
  'Available' | 'Preparing' | 'Charging' | 'SuspendedEV' | 'Finishing' | 'Faulted';

interface PendingCall {
  resolve: (payload: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class OcppSimulator extends EventEmitter {
  private socket: WebSocket | null = null;
  private readonly pending = new Map<string, PendingCall>();
  private heartbeatTimer?: NodeJS.Timeout;
  private meterTimer?: NodeJS.Timeout;
  private encerrandoDeProposito = false;

  private meterWh: number;
  private connectorStates = new Map<number, ConnectorState>();

  /** transactionId atribuído pelo servidor no StartTransaction. */
  transactionId: number | null = null;
  idTag: string | null = null;
  bootAccepted = false;

  private readonly opts: Required<
    Pick<
      SimulatorOptions,
      | 'vendor'
      | 'model'
      | 'firmwareVersion'
      | 'connectors'
      | 'powerKw'
      | 'heartbeatIntervalMs'
      | 'meterIntervalMs'
      | 'initialMeterWh'
      | 'energyUnit'
      | 'reconnectDelayMs'
    >
  > &
    SimulatorOptions;

  constructor(options: SimulatorOptions) {
    super();

    this.opts = {
      vendor: 'Borá Simulador',
      model: 'SIM-30kW',
      firmwareVersion: '1.0.0-sim',
      connectors: 1,
      powerKw: 30,
      heartbeatIntervalMs: 30_000,
      meterIntervalMs: 1_000,
      initialMeterWh: 1_000_000,
      energyUnit: 'Wh',
      reconnectDelayMs: 1_000,
      ...options,
    };

    this.meterWh = this.opts.initialMeterWh;

    for (let i = 1; i <= this.opts.connectors; i += 1) {
      this.connectorStates.set(i, 'Available');
    }
  }

  // -------------------------------------------------------------------------
  // Conexão
  // -------------------------------------------------------------------------

  async connect(): Promise<void> {
    this.encerrandoDeProposito = false;

    const url = `${this.opts.url.replace(/\/$/, '')}/${encodeURIComponent(this.opts.chargePointIdentity)}`;

    const headers: Record<string, string> = {};
    if (this.opts.password !== undefined) {
      const credencial = `${this.opts.chargePointIdentity}:${this.opts.password}`;
      headers.Authorization = `Basic ${Buffer.from(credencial).toString('base64')}`;
    }

    // O subprotocolo é obrigatório no OCPP-J.
    const socket = new WebSocket(url, [OCPP_SUBPROTOCOL], { headers });
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      const aoFalhar = (error: Error) => {
        socket.off('open', aoAbrir);
        reject(error);
      };
      const aoAbrir = () => {
        socket.off('error', aoFalhar);
        resolve();
      };

      socket.once('open', aoAbrir);
      socket.once('error', aoFalhar);
      socket.once('unexpected-response', (_req, res) => {
        socket.off('open', aoAbrir);
        reject(
          new Error(
            `servidor recusou a conexão: HTTP ${res.statusCode} ${res.headers['x-reason'] ?? ''}`,
          ),
        );
      });
    });

    socket.on('message', (data) => {
      this.tratarMensagem(typeof data === 'string' ? data : data.toString('utf8'));
    });

    socket.on('close', (code, motivo) => {
      this.pararTemporizadores();
      this.emit('disconnected', { code, reason: motivo.toString() });

      // Carregador real reconecta sozinho. Sem isso, o simulador não serviria
      // para testar reconexão.
      if (this.opts.autoReconnect && !this.encerrandoDeProposito) {
        setTimeout(() => {
          void this.connect()
            .then(() => this.bootNotification())
            .then(() => this.emit('reconnected'))
            .catch((error: unknown) => this.emit('reconnect-failed', error));
        }, this.opts.reconnectDelayMs);
      }
    });

    socket.on('error', (error) => this.emit('socket-error', error));

    this.emit('connected');
  }

  /** Encerra a conexão de propósito, sem disparar reconexão automática. */
  async disconnect(code = 1000): Promise<void> {
    this.encerrandoDeProposito = true;
    this.pararTemporizadores();

    const socket = this.socket;
    if (!socket) return;

    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      await new Promise<void>((resolve) => {
        socket.once('close', () => resolve());
        socket.close(code);
        // Se o servidor não confirmar o fechamento, forçamos.
        setTimeout(() => {
          socket.terminate();
          resolve();
        }, 1_000).unref?.();
      });
    }

    this.socket = null;
  }

  /**
   * Simula perda abrupta de conexão (queda de 4G).
   *
   * `terminate` mata o socket sem handshake de fechamento — é o que acontece de
   * verdade quando o sinal cai, e é bem diferente de um `close` limpo: o servidor
   * demora para perceber.
   */
  simulateConnectionLoss(): void {
    this.pararTemporizadores();
    this.socket?.terminate();
  }

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  // -------------------------------------------------------------------------
  // Mensagens que o carregador envia
  // -------------------------------------------------------------------------

  async bootNotification(): Promise<Record<string, unknown>> {
    const resposta = await this.call('BootNotification', {
      chargePointVendor: this.opts.vendor,
      chargePointModel: this.opts.model,
      firmwareVersion: this.opts.firmwareVersion,
      ...(this.opts.serialNumber ? { chargePointSerialNumber: this.opts.serialNumber } : {}),
    });

    this.bootAccepted = resposta.status === 'Accepted';

    // O servidor manda o intervalo de heartbeat; um carregador real obedece.
    const intervalo = typeof resposta.interval === 'number' ? resposta.interval * 1000 : undefined;
    if (this.bootAccepted) this.iniciarHeartbeat(intervalo);

    return resposta;
  }

  async heartbeat(): Promise<Record<string, unknown>> {
    return this.call('Heartbeat', {});
  }

  async statusNotification(
    connectorId: number,
    status: ConnectorState,
    errorCode = 'NoError',
  ): Promise<Record<string, unknown>> {
    this.connectorStates.set(connectorId, status);

    return this.call('StatusNotification', {
      connectorId,
      status,
      errorCode,
      timestamp: new Date().toISOString(),
    });
  }

  async authorize(idTag: string): Promise<Record<string, unknown>> {
    return this.call('Authorize', { idTag });
  }

  /** Simula o motorista plugando o veículo. */
  async plugIn(connectorId = 1): Promise<void> {
    await this.statusNotification(connectorId, 'Preparing');
  }

  async startTransaction(connectorId = 1, idTag?: string): Promise<Record<string, unknown>> {
    const tag = idTag ?? this.idTag ?? 'SIMULADOR';

    const resposta = await this.call('StartTransaction', {
      connectorId,
      idTag: tag,
      meterStart: this.meterWh,
      timestamp: new Date().toISOString(),
    });

    if (typeof resposta.transactionId === 'number') {
      this.transactionId = resposta.transactionId;
      this.idTag = tag;
      await this.statusNotification(connectorId, 'Charging');
      this.iniciarMedicao(connectorId);
    }

    return resposta;
  }

  async meterValues(connectorId = 1): Promise<Record<string, unknown>> {
    const amostras: Record<string, unknown>[] = [this.amostraDeEnergia()];

    // Um carregador real manda mais do que energia.
    amostras.push({
      value: String(this.opts.powerKw * 1000),
      measurand: 'Power.Active.Import',
      unit: 'W',
      context: 'Sample.Periodic',
    });

    if (this.opts.sendOutOfOrderMeterValues) {
      // Repete uma leitura mais antiga: o servidor não pode reduzir a energia
      // acumulada por causa disso.
      amostras.push({
        value: this.formatarEnergia(Math.max(0, this.meterWh - 5_000)),
        measurand: 'Energy.Active.Import.Register',
        unit: this.opts.energyUnit,
        context: 'Sample.Periodic',
      });
    }

    return this.call('MeterValues', {
      connectorId,
      ...(this.transactionId !== null ? { transactionId: this.transactionId } : {}),
      meterValue: [{ timestamp: new Date().toISOString(), sampledValue: amostras }],
    });
  }

  async stopTransaction(reason = 'Local', connectorId = 1): Promise<Record<string, unknown>> {
    if (this.transactionId === null) {
      throw new Error('não há transação em andamento para encerrar');
    }

    this.pararMedicao();

    const resposta = await this.call('StopTransaction', {
      transactionId: this.transactionId,
      meterStop: this.meterWh,
      timestamp: new Date().toISOString(),
      reason,
      ...(this.idTag ? { idTag: this.idTag } : {}),
    });

    this.transactionId = null;
    await this.statusNotification(connectorId, 'Finishing');
    await this.statusNotification(connectorId, 'Available');

    return resposta;
  }

  /** Simula uma falha reportada pelo equipamento. */
  async simulateFault(connectorId = 1, errorCode = 'OtherError'): Promise<void> {
    this.pararMedicao();
    await this.statusNotification(connectorId, 'Faulted', errorCode);
  }

  /** Envia uma ação que o servidor não implementa, para testar NotImplemented. */
  async sendUnsupportedAction(): Promise<Record<string, unknown>> {
    return this.call('DiagnosticsStatusNotification', { status: 'Idle' });
  }

  /** Envia texto que não é JSON válido, para testar FormationViolation. */
  sendMalformedJson(): void {
    this.socket?.send('{isso não é json válido');
  }

  /** Envia um array OCPP com estrutura inválida. */
  sendInvalidStructure(): void {
    this.socket?.send(JSON.stringify([2, 'msg-invalido']));
  }

  /** Envia payload que não passa na validação da ação. */
  async sendInvalidPayload(): Promise<Record<string, unknown>> {
    // BootNotification sem chargePointModel, que é obrigatório.
    return this.call('BootNotification', { chargePointVendor: 'WEG' });
  }

  /** Reenvia uma CALL com messageId já usado, para testar deduplicação. */
  sendRawCall(messageId: string, action: string, payload: Record<string, unknown>): void {
    this.socket?.send(serializeCall(messageId, action, payload));
  }

  get meterReadingWh(): number {
    return this.meterWh;
  }

  connectorState(connectorId = 1): ConnectorState | undefined {
    return this.connectorStates.get(connectorId);
  }

  // -------------------------------------------------------------------------
  // Interno
  // -------------------------------------------------------------------------

  private amostraDeEnergia(): Record<string, unknown> {
    return {
      value: this.formatarEnergia(this.meterWh),
      measurand: 'Energy.Active.Import.Register',
      unit: this.opts.energyUnit,
      context: 'Sample.Periodic',
    };
  }

  private formatarEnergia(wh: number): string {
    return this.opts.energyUnit === 'kWh' ? (wh / 1000).toFixed(3) : String(wh);
  }

  private call(
    action: string,
    payload: Record<string, unknown>,
    timeoutMs = 10_000,
  ): Promise<Record<string, unknown>> {
    const socket = this.socket;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('simulador não está conectado'));
    }

    const messageId = randomUUID();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(messageId);
        reject(new Error(`servidor não respondeu ${action} em ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref?.();

      this.pending.set(messageId, { resolve, reject, timer });
      socket.send(serializeCall(messageId, action, payload));
    });
  }

  private tratarMensagem(raw: string): void {
    let mensagem;
    try {
      mensagem = parseMessage(raw);
    } catch {
      this.emit('parse-error', raw);
      return;
    }

    if (mensagem.type === MessageType.CALLRESULT) {
      const pendente = this.pending.get(mensagem.messageId);
      if (pendente) {
        clearTimeout(pendente.timer);
        this.pending.delete(mensagem.messageId);
        pendente.resolve(mensagem.payload);
      }
      return;
    }

    if (mensagem.type === MessageType.CALLERROR) {
      const pendente = this.pending.get(mensagem.messageId);
      if (pendente) {
        clearTimeout(pendente.timer);
        this.pending.delete(mensagem.messageId);
        pendente.reject(new Error(`${mensagem.errorCode}: ${mensagem.errorDescription}`));
      }
      this.emit('call-error', mensagem);
      return;
    }

    void this.tratarComando(mensagem.messageId, mensagem.action, mensagem.payload);
  }

  /** Comandos que o servidor envia ao carregador. */
  private async tratarComando(
    messageId: string,
    action: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    this.emit('command', { action, payload });

    // Silêncio deliberado: exercita o timeout do lado do servidor.
    if (this.opts.goSilent) return;

    if (this.opts.respondWithCallError) {
      this.socket?.send(
        serializeCallError(messageId, OcppErrorCode.InternalError, 'falha simulada'),
      );
      return;
    }

    switch (action) {
      case 'RemoteStartTransaction': {
        const aceito = !this.opts.rejectRemoteStart;
        this.socket?.send(
          serializeCallResult(messageId, { status: aceito ? 'Accepted' : 'Rejected' }),
        );

        if (!aceito) return;

        const connectorId = typeof payload.connectorId === 'number' ? payload.connectorId : 1;
        if (typeof payload.idTag === 'string') this.idTag = payload.idTag;

        // Carregador real leva um instante entre aceitar e iniciar.
        if (this.opts.neverStartTransaction) {
          this.emit('remote-start-accepted-without-transaction');
          return;
        }

        setTimeout(() => {
          void this.startTransaction(connectorId, this.idTag ?? undefined).catch((error: unknown) =>
            this.emit('start-transaction-failed', error),
          );
        }, 50);
        return;
      }

      case 'RemoteStopTransaction': {
        const aceito = !this.opts.rejectRemoteStop && this.transactionId !== null;
        this.socket?.send(
          serializeCallResult(messageId, { status: aceito ? 'Accepted' : 'Rejected' }),
        );

        if (!aceito) return;

        setTimeout(() => {
          void this.stopTransaction('Remote').catch((error: unknown) =>
            this.emit('stop-transaction-failed', error),
          );
        }, 50);
        return;
      }

      default:
        this.socket?.send(
          serializeCallError(
            messageId,
            OcppErrorCode.NotImplemented,
            `ação ${action} não suportada`,
          ),
        );
    }
  }

  private iniciarHeartbeat(intervalo?: number): void {
    this.pararHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      void this.heartbeat().catch((error: unknown) => this.emit('heartbeat-failed', error));
    }, intervalo ?? this.opts.heartbeatIntervalMs);

    this.heartbeatTimer.unref?.();
  }

  private iniciarMedicao(connectorId: number): void {
    this.pararMedicao();

    // Incremento proporcional à potência e ao intervalo — o medidor de um
    // carregador de 30 kW sobe 500 Wh por minuto.
    const whPorIntervalo = (this.opts.powerKw * 1000 * this.opts.meterIntervalMs) / 3_600_000;

    this.meterTimer = setInterval(() => {
      this.meterWh += Math.round(whPorIntervalo);
      void this.meterValues(connectorId).catch((error: unknown) =>
        this.emit('meter-values-failed', error),
      );
    }, this.opts.meterIntervalMs);

    this.meterTimer.unref?.();
  }

  /** Avança o medidor sem esperar o temporizador. Usado nos testes. */
  advanceMeter(wh: number): void {
    this.meterWh += wh;
  }

  private pararHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  private pararMedicao(): void {
    if (this.meterTimer) clearInterval(this.meterTimer);
    this.meterTimer = undefined;
  }

  private pararTemporizadores(): void {
    this.pararHeartbeat();
    this.pararMedicao();

    for (const [messageId, pendente] of this.pending) {
      clearTimeout(pendente.timer);
      pendente.reject(new Error('conexão encerrada antes da resposta'));
      this.pending.delete(messageId);
    }
  }
}
