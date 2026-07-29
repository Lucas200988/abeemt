import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { canStartCharging, type DomainConnectorStatus } from '@bora/ocpp-core';
import { PrismaService } from '../../prisma/prisma.service';
import { ConnectionRegistry } from './connection-registry';
import { CallDispatcher } from './call-dispatcher';

/**
 * Resultado de um comando, já com mensagem pronta para a tela.
 *
 * A separação entre `message` (português, para o operador) e `technicalDetail`
 * (o motivo cru) atende a seção 14 do briefing: nunca mostrar
 * "RemoteStartTransaction rejected" para uma pessoa.
 */
export interface CommandResult {
  accepted: boolean;
  message: string;
  code: string;
  technicalDetail?: unknown;
  sessionId?: string;
  transactionId?: number;
}

@Injectable()
export class OcppCommands {
  private readonly logger = new Logger(OcppCommands.name);

  /**
   * Prazo para o carregador ACEITAR o comando (regra 11.5: 120 segundos).
   *
   * Não confundir com o prazo para o veículo começar a carregar, que é maior e
   * será tratado pelo worker de timeouts na FASE 5.
   */
  private static readonly ACCEPT_TIMEOUT_MS = 120_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ConnectionRegistry,
    private readonly dispatcher: CallDispatcher,
  ) {}

  /**
   * Envia RemoteStartTransaction, validando as pré-condições da regra 11.4.
   *
   * As verificações acontecem ANTES de enviar o comando porque cada uma tem um
   * tratamento distinto do lado comercial — o briefing (seção 11.8) exige
   * diferenciar "carregador offline" de "conector ocupado" de "comando recusado".
   */
  async remoteStart(input: { sessionId: string; correlationId?: string }): Promise<CommandResult> {
    const correlationId = input.correlationId ?? randomUUID();

    const sessao = await this.prisma.chargingSession.findUnique({
      where: { id: input.sessionId },
      select: {
        id: true,
        status: true,
        idTag: true,
        charger: {
          select: { id: true, chargePointIdentity: true, operationalStatus: true },
        },
        connector: { select: { id: true, connectorNumber: true, status: true } },
      },
    });

    if (!sessao) {
      return {
        accepted: false,
        code: 'SESSION_NOT_FOUND',
        message: 'Sessão não encontrada.',
      };
    }

    if (sessao.status !== 'PAYMENT_APPROVED' && sessao.status !== 'AWAITING_CHARGER') {
      return {
        accepted: false,
        code: 'INVALID_SESSION_STATUS',
        message: 'Esta sessão não está em condição de iniciar a recarga.',
        technicalDetail: { status: sessao.status },
        sessionId: sessao.id,
      };
    }

    if (sessao.charger.operationalStatus !== 'AVAILABLE') {
      return {
        accepted: false,
        code: 'CHARGER_BLOCKED',
        message:
          sessao.charger.operationalStatus === 'BLOCKED'
            ? 'Este carregador está bloqueado.'
            : 'Este carregador está em manutenção.',
        sessionId: sessao.id,
      };
    }

    if (!this.registry.isOnline(sessao.charger.chargePointIdentity)) {
      return {
        accepted: false,
        code: 'CHARGER_OFFLINE',
        message: 'O carregador está desconectado. Não é possível iniciar a recarga agora.',
        sessionId: sessao.id,
      };
    }

    if (!canStartCharging(sessao.connector.status as DomainConnectorStatus)) {
      return {
        accepted: false,
        code: 'CONNECTOR_UNAVAILABLE',
        message: 'O conector não está disponível para iniciar uma recarga.',
        technicalDetail: { status: sessao.connector.status },
        sessionId: sessao.id,
      };
    }

    /**
     * Não há verificação de "conector ocupado" aqui, e isso é deliberado.
     *
     * O índice parcial `charging_sessions_one_active_per_connector` cobre TODOS
     * os estados ativos, inclusive `PAYMENT_APPROVED`. Consequência: duas
     * sessões nunca coexistem em estado ativo no mesmo conector — o banco recusa
     * a **criação** da segunda, muito antes de alguém chamar este método.
     *
     * Uma verificação aqui seria código inalcançável. O caminho real é a camada
     * de pagamento (FASE 5) receber P2002 ao aprovar o pagamento, e o filtro
     * global traduzir isso para "Este conector já possui uma recarga em
     * andamento." (ver all-exceptions.filter.ts).
     *
     * Verificado em 2026-07-29 por teste que tenta criar a segunda sessão.
     */

    // O idTag identifica a sessão para o carregador. Derivamos do id da sessão
    // porque o OCPP limita a 20 caracteres — um UUID completo não cabe.
    const idTag = sessao.idTag ?? this.gerarIdTag(sessao.id);

    await this.prisma.chargingSession.update({
      where: { id: sessao.id },
      data: { status: 'COMMAND_SENT', idTag, authorizedAt: new Date() },
    });

    const resultado = await this.dispatcher.call(
      sessao.charger.chargePointIdentity,
      'RemoteStartTransaction',
      { idTag, connectorId: sessao.connector.connectorNumber },
      { timeoutMs: OcppCommands.ACCEPT_TIMEOUT_MS, correlationId },
    );

    if (!resultado.ok) {
      // Cada motivo de falha vira um estado distinto: o operador precisa saber
      // se o problema foi comunicação ou recusa do equipamento.
      const status = resultado.reason === 'TIMEOUT' ? 'EXPIRED' : 'FAILED';

      await this.prisma.chargingSession.update({
        where: { id: sessao.id },
        data: { status, failureReason: `${resultado.reason}: ${resultado.message}` },
      });

      this.logger.warn(
        { sessionId: sessao.id, reason: resultado.reason, correlationId },
        'RemoteStartTransaction não foi aceito',
      );

      return {
        accepted: false,
        code: resultado.reason,
        message: resultado.message,
        technicalDetail: resultado.details,
        sessionId: sessao.id,
      };
    }

    const aceito = resultado.payload.status === 'Accepted';

    if (!aceito) {
      await this.prisma.chargingSession.update({
        where: { id: sessao.id },
        data: {
          status: 'DECLINED',
          failureReason: 'carregador recusou o comando de início (RemoteStartTransaction Rejected)',
        },
      });

      return {
        accepted: false,
        code: 'REJECTED_BY_CHARGER',
        // A frase que vai para a tela, não o termo do protocolo.
        message: 'O carregador recusou o comando de início da recarga.',
        technicalDetail: { status: 'Rejected' },
        sessionId: sessao.id,
      };
    }

    await this.prisma.chargingSession.update({
      where: { id: sessao.id },
      data: { status: 'STARTING' },
    });

    this.logger.log(
      { sessionId: sessao.id, correlationId, durationMs: resultado.durationMs },
      'RemoteStartTransaction aceito pelo carregador',
    );

    return {
      accepted: true,
      code: 'ACCEPTED',
      message: 'Comando aceito. Aguardando o veículo iniciar a recarga.',
      sessionId: sessao.id,
    };
  }

  /**
   * Envia RemoteStopTransaction.
   *
   * O encerramento definitivo da sessão acontece quando o `StopTransaction`
   * chega — não aqui. Aceitar o comando não é o mesmo que a recarga ter parado, e
   * confundir os dois marcaria a sessão como concluída sem ter a leitura final
   * do medidor.
   */
  async remoteStop(input: { sessionId: string; correlationId?: string }): Promise<CommandResult> {
    const correlationId = input.correlationId ?? randomUUID();

    const sessao = await this.prisma.chargingSession.findUnique({
      where: { id: input.sessionId },
      select: {
        id: true,
        status: true,
        ocppTransactionId: true,
        charger: { select: { chargePointIdentity: true } },
      },
    });

    if (!sessao) {
      return { accepted: false, code: 'SESSION_NOT_FOUND', message: 'Sessão não encontrada.' };
    }

    if (sessao.ocppTransactionId === null) {
      return {
        accepted: false,
        code: 'NOT_STARTED',
        message: 'Esta recarga ainda não começou, então não há o que parar.',
        sessionId: sessao.id,
      };
    }

    if (sessao.status === 'COMPLETED') {
      // Idempotente: parar uma recarga já encerrada não é erro.
      return {
        accepted: true,
        code: 'ALREADY_COMPLETED',
        message: 'Esta recarga já foi encerrada.',
        sessionId: sessao.id,
      };
    }

    if (!this.registry.isOnline(sessao.charger.chargePointIdentity)) {
      return {
        accepted: false,
        code: 'CHARGER_OFFLINE',
        message:
          'O carregador está desconectado. A recarga será encerrada quando a comunicação voltar.',
        sessionId: sessao.id,
      };
    }

    const resultado = await this.dispatcher.call(
      sessao.charger.chargePointIdentity,
      'RemoteStopTransaction',
      { transactionId: sessao.ocppTransactionId },
      { correlationId },
    );

    if (!resultado.ok) {
      this.logger.warn(
        { sessionId: sessao.id, reason: resultado.reason, correlationId },
        'RemoteStopTransaction não foi aceito',
      );

      return {
        accepted: false,
        code: resultado.reason,
        message: resultado.message,
        technicalDetail: resultado.details,
        sessionId: sessao.id,
      };
    }

    if (resultado.payload.status !== 'Accepted') {
      return {
        accepted: false,
        code: 'REJECTED_BY_CHARGER',
        message: 'O carregador recusou o comando para encerrar a recarga.',
        sessionId: sessao.id,
      };
    }

    // FINISHING, não COMPLETED: a sessão só fecha com o StopTransaction, que
    // traz a leitura final do medidor.
    await this.prisma.chargingSession.update({
      where: { id: sessao.id },
      data: { status: 'FINISHING' },
    });

    return {
      accepted: true,
      code: 'ACCEPTED',
      message: 'Comando aceito. Encerrando a recarga.',
      sessionId: sessao.id,
      transactionId: sessao.ocppTransactionId,
    };
  }

  /**
   * idTag a partir do id da sessão.
   *
   * O OCPP limita idTag a 20 caracteres (CiString20), e um UUID tem 36. Usamos
   * os 20 primeiros caracteres hexadecimais do UUID: colisão exigiria 2^80
   * combinações, o que não é preocupação real.
   */
  private gerarIdTag(sessionId: string): string {
    return sessionId.replace(/-/g, '').slice(0, 20).toUpperCase();
  }

  /** Estado do servidor OCPP, para o health check (briefing seção 13). */
  status(): { onlineChargers: number; pendingCommands: number; identities: string[] } {
    return {
      onlineChargers: this.registry.count(),
      pendingCommands: this.dispatcher.pendingCount(),
      identities: this.registry.onlineIdentities(),
    };
  }
}
