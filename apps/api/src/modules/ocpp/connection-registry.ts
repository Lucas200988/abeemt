import { Injectable, Logger } from '@nestjs/common';
import type { WebSocket } from 'ws';

/**
 * Registro das conexões WebSocket ativas.
 *
 * **Este mapa NÃO é a fonte da verdade** (ADR-0006, risco R-13). Ele responde
 * apenas a uma pergunta: "consigo falar com este carregador agora?". Se o
 * processo reiniciar, o mapa se esvazia — e nenhuma sessão paga pode ser perdida
 * por causa disso. O estado comercial vive no banco.
 *
 * Também resolve o caso de reconexão: quando um carregador reconecta sem que o
 * socket antigo tenha sido fechado (queda de 4G costuma deixar o socket velho
 * "vivo" por minutos), a conexão anterior é derrubada. Sem isso, comandos
 * poderiam ser enviados para um socket que nunca vai responder.
 */

export interface ActiveConnection {
  chargePointIdentity: string;
  chargerId: string;
  socket: WebSocket;
  connectedAt: Date;
  /**
   * Fila de processamento da conexão.
   *
   * Mensagens de um mesmo carregador precisam ser processadas em ordem: um
   * MeterValues que chegue antes do StartTransaction ser gravado não encontraria
   * a sessão. Handlers assíncronos podem intercalar, então serializamos.
   */
  queue: Promise<void>;
}

@Injectable()
export class ConnectionRegistry {
  private readonly logger = new Logger(ConnectionRegistry.name);
  private readonly connections = new Map<string, ActiveConnection>();

  /**
   * Registra a conexão. Se já existir uma para a mesma identity, a antiga é
   * derrubada e devolvida, para que o chamador possa registrar o evento.
   */
  register(chargePointIdentity: string, chargerId: string, socket: WebSocket): ActiveConnection {
    const anterior = this.connections.get(chargePointIdentity);

    if (anterior) {
      this.logger.warn(
        { chargePointIdentity },
        'reconexão com conexão anterior ainda aberta — derrubando a antiga',
      );

      try {
        // 1012 = Service Restart. O carregador reconecta sozinho.
        anterior.socket.close(1012, 'substituida por nova conexao');
      } catch {
        // Socket já morto; o objetivo era só garantir que não fica pendurado.
      }
    }

    const conexao: ActiveConnection = {
      chargePointIdentity,
      chargerId,
      socket,
      connectedAt: new Date(),
      queue: Promise.resolve(),
    };

    this.connections.set(chargePointIdentity, conexao);
    return conexao;
  }

  /**
   * Remove a conexão, mas **apenas se for a mesma instância de socket**.
   *
   * Sem essa verificação, o evento `close` do socket antigo (que chega depois da
   * reconexão) apagaria o registro da conexão nova, deixando o carregador
   * inalcançável apesar de conectado.
   */
  unregister(chargePointIdentity: string, socket: WebSocket): boolean {
    const atual = this.connections.get(chargePointIdentity);

    if (!atual || atual.socket !== socket) return false;

    this.connections.delete(chargePointIdentity);
    return true;
  }

  get(chargePointIdentity: string): ActiveConnection | undefined {
    return this.connections.get(chargePointIdentity);
  }

  isOnline(chargePointIdentity: string): boolean {
    return this.connections.has(chargePointIdentity);
  }

  /** Identities conectadas agora — usado pelo health check e pelo painel. */
  onlineIdentities(): string[] {
    return [...this.connections.keys()];
  }

  count(): number {
    return this.connections.size;
  }

  /**
   * Enfileira um trabalho na conexão, garantindo ordem.
   *
   * Um erro em um item não interrompe a fila: o carregador continua conectado e
   * as mensagens seguintes precisam ser processadas.
   */
  enqueue(chargePointIdentity: string, task: () => Promise<void>): void {
    const conexao = this.connections.get(chargePointIdentity);
    if (!conexao) return;

    conexao.queue = conexao.queue.then(task).catch((error: unknown) => {
      this.logger.error(
        { err: error, chargePointIdentity },
        'falha ao processar mensagem OCPP na fila da conexão',
      );
    });
  }

  /** Fecha todas as conexões. Usado no encerramento da aplicação. */
  closeAll(): void {
    for (const [identity, conexao] of this.connections) {
      try {
        conexao.socket.close(1001, 'servidor encerrando');
      } catch {
        // Ignorado: estamos desligando de todo jeito.
      }
      this.connections.delete(identity);
    }
  }
}
