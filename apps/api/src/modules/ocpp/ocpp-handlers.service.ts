import { Injectable, Logger } from '@nestjs/common';
import {
  ENERGY_REGISTER,
  extractEnergyWh,
  reconcileMeterReading,
  toDomainConnectorStatus,
  type AuthorizeRequestType,
  type BootNotificationRequestType,
  type MeterValuesRequestType,
  type StartTransactionRequestType,
  type StatusNotificationRequestType,
  type StopTransactionRequestType,
} from '@bora/ocpp-core';
import { Prisma, type SessionStatus, type StopReason } from '@bora/database';
import { PrismaService } from '../../prisma/prisma.service';
import { SessionPricingService } from '../pricing/session-pricing.service';
import { OcppCommands } from './ocpp-commands.service';

/** Contexto de cada mensagem recebida, montado pelo gateway. */
export interface HandlerContext {
  chargerId: string;
  chargePointIdentity: string;
  correlationId: string;
  /** Instante de recebimento, injetado para que os testes possam fixá-lo. */
  receivedAt: Date;
}

/**
 * Regras de negócio disparadas pelas mensagens do carregador.
 *
 * Tudo que muda estado comercial passa por aqui e vai para o banco (ADR-0006).
 * Os handlers devolvem o payload da CALLRESULT; o gateway cuida do envelope.
 */
@Injectable()
export class OcppHandlers {
  private readonly logger = new Logger(OcppHandlers.name);

  /** Intervalo de heartbeat que pedimos ao carregador, em segundos. */
  private static readonly HEARTBEAT_INTERVAL = 300;

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: SessionPricingService,
    private readonly commands: OcppCommands,
  ) {}

  // -------------------------------------------------------------------------
  // BootNotification
  // -------------------------------------------------------------------------

  /**
   * O carregador se apresenta ao conectar (e após cada reinício).
   *
   * Aproveitamos para gravar fabricante, modelo e firmware — dados que o
   * levantamento do WEMOB pede e que aqui vêm do próprio equipamento, sem
   * depender de leitura manual do menu técnico.
   */
  async bootNotification(
    payload: BootNotificationRequestType,
    ctx: HandlerContext,
  ): Promise<{ status: string; currentTime: string; interval: number }> {
    const charger = await this.prisma.charger.findUnique({
      where: { id: ctx.chargerId },
      select: { operationalStatus: true },
    });

    // Carregador bloqueado pelo operador recebe "Pending": mantém a conexão,
    // mas não deve iniciar transação. Rejected faria o equipamento parar de
    // tentar, o que dificultaria o desbloqueio remoto.
    const bloqueado = charger?.operationalStatus === 'BLOCKED';

    await this.prisma.charger.update({
      where: { id: ctx.chargerId },
      data: {
        manufacturer: payload.chargePointVendor,
        model: payload.chargePointModel,
        serialNumber: payload.chargePointSerialNumber ?? payload.chargeBoxSerialNumber ?? undefined,
        firmwareVersion: payload.firmwareVersion ?? undefined,
        connectionStatus: 'ONLINE',
        lastBootAt: ctx.receivedAt,
        lastSeenAt: ctx.receivedAt,
        // Guardamos o que o equipamento informa sobre o modem, útil para
        // diagnosticar qualidade de sinal na FASE 4.
        metadata: {
          iccid: payload.iccid ?? null,
          imsi: payload.imsi ?? null,
          meterType: payload.meterType ?? null,
          meterSerialNumber: payload.meterSerialNumber ?? null,
        } as Prisma.InputJsonValue,
      },
    });

    this.logger.log(
      {
        chargerId: ctx.chargerId,
        chargePointIdentity: ctx.chargePointIdentity,
        vendor: payload.chargePointVendor,
        model: payload.chargePointModel,
        firmware: payload.firmwareVersion,
        correlationId: ctx.correlationId,
      },
      bloqueado ? 'BootNotification de carregador bloqueado' : 'BootNotification aceito',
    );

    return {
      status: bloqueado ? 'Pending' : 'Accepted',
      currentTime: ctx.receivedAt.toISOString(),
      interval: OcppHandlers.HEARTBEAT_INTERVAL,
    };
  }

  // -------------------------------------------------------------------------
  // Heartbeat
  // -------------------------------------------------------------------------

  async heartbeat(ctx: HandlerContext): Promise<{ currentTime: string }> {
    await this.prisma.charger.update({
      where: { id: ctx.chargerId },
      data: {
        lastHeartbeatAt: ctx.receivedAt,
        lastSeenAt: ctx.receivedAt,
        connectionStatus: 'ONLINE',
      },
    });

    return { currentTime: ctx.receivedAt.toISOString() };
  }

  // -------------------------------------------------------------------------
  // StatusNotification
  // -------------------------------------------------------------------------

  /**
   * Mudança de estado de um conector.
   *
   * O conector 0 representa o carregador inteiro no OCPP 1.6, não um ponto de
   * recarga — por isso não tem linha na tabela de conectores.
   */
  async statusNotification(
    payload: StatusNotificationRequestType,
    ctx: HandlerContext,
  ): Promise<Record<string, never>> {
    const timestamp = payload.timestamp ?? ctx.receivedAt;

    await this.prisma.charger.update({
      where: { id: ctx.chargerId },
      data: { lastSeenAt: ctx.receivedAt, connectionStatus: 'ONLINE' },
    });

    if (payload.connectorId === 0) {
      this.logger.log(
        { chargerId: ctx.chargerId, status: payload.status, errorCode: payload.errorCode },
        'StatusNotification do carregador (conector 0)',
      );
      return {};
    }

    const status = toDomainConnectorStatus(payload.status);

    // upsert: um carregador pode anunciar um conector que ainda não cadastramos.
    // Recusar significaria perder o estado real do equipamento.
    await this.prisma.connector.upsert({
      where: {
        chargerId_connectorNumber: {
          chargerId: ctx.chargerId,
          connectorNumber: payload.connectorId,
        },
      },
      update: {
        status,
        errorCode: payload.errorCode === 'NoError' ? null : payload.errorCode,
        lastStatusAt: timestamp,
      },
      create: {
        chargerId: ctx.chargerId,
        connectorNumber: payload.connectorId,
        status,
        errorCode: payload.errorCode === 'NoError' ? null : payload.errorCode,
        lastStatusAt: timestamp,
      },
    });

    if (payload.errorCode !== 'NoError') {
      this.logger.error(
        {
          chargerId: ctx.chargerId,
          connectorId: payload.connectorId,
          errorCode: payload.errorCode,
          info: payload.info,
          vendorErrorCode: payload.vendorErrorCode,
          correlationId: ctx.correlationId,
        },
        'carregador reportou falha no conector',
      );
    }

    return {};
  }

  // -------------------------------------------------------------------------
  // Authorize
  // -------------------------------------------------------------------------

  /**
   * O carregador pergunta se um idTag pode carregar.
   *
   * No MVP, autorização vem do pagamento — não há cartão RFID nem lista local.
   * Aceitamos apenas idTags que correspondem a uma sessão nossa aguardando
   * início. Qualquer outro é `Invalid`: sem isso, qualquer cartão RFID
   * encostado no leitor iniciaria uma recarga de graça.
   */
  async authorize(
    payload: AuthorizeRequestType,
    ctx: HandlerContext,
  ): Promise<{ idTagInfo: { status: string } }> {
    const sessao = await this.prisma.chargingSession.findFirst({
      where: {
        chargerId: ctx.chargerId,
        idTag: payload.idTag,
        status: { in: ['PAYMENT_APPROVED', 'AWAITING_CHARGER', 'COMMAND_SENT', 'STARTING'] },
      },
      select: { id: true },
    });

    const autorizado = sessao !== null;

    this.logger.log(
      {
        chargerId: ctx.chargerId,
        idTag: payload.idTag,
        autorizado,
        sessionId: sessao?.id,
        correlationId: ctx.correlationId,
      },
      autorizado ? 'idTag autorizado' : 'idTag sem sessão paga correspondente',
    );

    return { idTagInfo: { status: autorizado ? 'Accepted' : 'Invalid' } };
  }

  // -------------------------------------------------------------------------
  // StartTransaction
  // -------------------------------------------------------------------------

  /**
   * O carregador informa que a recarga começou.
   *
   * Aqui atribuímos o `transactionId` — no OCPP 1.6 é o Central System que
   * decide, e precisa ser um inteiro. Vem de uma sequência do Postgres, porque
   * `max(id) + 1` perde a corrida entre dois StartTransaction simultâneos.
   */
  async startTransaction(
    payload: StartTransactionRequestType,
    ctx: HandlerContext,
  ): Promise<{ transactionId: number; idTagInfo: { status: string } }> {
    const transactionId = await this.nextTransactionId();

    const connector = await this.prisma.connector.findUnique({
      where: {
        chargerId_connectorNumber: {
          chargerId: ctx.chargerId,
          connectorNumber: payload.connectorId,
        },
      },
      select: { id: true },
    });

    // Procuramos a sessão que já esperava este início — criada quando o
    // pagamento foi aprovado.
    const sessao = connector
      ? await this.prisma.chargingSession.findFirst({
          where: {
            chargerId: ctx.chargerId,
            connectorId: connector.id,
            status: { in: ['PAYMENT_APPROVED', 'AWAITING_CHARGER', 'COMMAND_SENT', 'STARTING'] },
          },
          orderBy: { requestedAt: 'desc' },
          select: { id: true },
        })
      : null;

    if (!sessao) {
      /**
       * Recarga iniciada localmente, sem passar pela plataforma (alguém usou o
       * cartão RFID do carregador, por exemplo).
       *
       * Aceitamos a transação — recusar deixaria o equipamento em estado
       * inconsistente com o nosso — mas registramos como sessão sem pagamento,
       * que é um caso que o briefing manda distinguir (seção 16) e que precisa
       * aparecer na conciliação.
       */
      this.logger.warn(
        {
          chargerId: ctx.chargerId,
          connectorId: payload.connectorId,
          idTag: payload.idTag,
          transactionId,
          correlationId: ctx.correlationId,
        },
        'StartTransaction sem sessão correspondente — registrando recarga sem pagamento',
      );

      await this.criarSessaoOrfa(payload, ctx, transactionId, connector?.id);

      return { transactionId, idTagInfo: { status: 'Accepted' } };
    }

    await this.prisma.chargingSession.update({
      where: { id: sessao.id },
      data: {
        status: 'CHARGING',
        ocppTransactionId: transactionId,
        idTag: payload.idTag,
        startedAt: payload.timestamp,
        meterStartWh: payload.meterStart,
      },
    });

    this.logger.log(
      {
        sessionId: sessao.id,
        chargerId: ctx.chargerId,
        transactionId,
        meterStart: payload.meterStart,
        correlationId: ctx.correlationId,
      },
      'recarga iniciada',
    );

    return { transactionId, idTagInfo: { status: 'Accepted' } };
  }

  // -------------------------------------------------------------------------
  // StopTransaction
  // -------------------------------------------------------------------------

  /**
   * A recarga terminou. Calculamos energia e duração.
   *
   * O valor financeiro **não** é calculado aqui: isso é FASE 6, e o cálculo
   * precisa usar a tarifa congelada na sessão.
   */
  async stopTransaction(
    payload: StopTransactionRequestType,
    ctx: HandlerContext,
  ): Promise<{ idTagInfo?: { status: string } }> {
    const sessao = await this.prisma.chargingSession.findFirst({
      where: { chargerId: ctx.chargerId, ocppTransactionId: payload.transactionId },
      select: {
        id: true,
        meterStartWh: true,
        startedAt: true,
        status: true,
        ceilingReachedAt: true,
      },
    });

    if (!sessao) {
      // Um StopTransaction para transação desconhecida acontece quando o
      // carregador reinicia com transação pendente. Responder Accepted encerra
      // o assunto do lado dele; ignorar faria o equipamento retransmitir sem fim.
      this.logger.warn(
        { chargerId: ctx.chargerId, transactionId: payload.transactionId },
        'StopTransaction para transação desconhecida',
      );
      return { idTagInfo: { status: 'Accepted' } };
    }

    if (sessao.status === 'COMPLETED') {
      this.logger.warn(
        { sessionId: sessao.id, transactionId: payload.transactionId },
        'StopTransaction repetido para sessão já concluída — ignorado',
      );
      return { idTagInfo: { status: 'Accepted' } };
    }

    const energia = this.calcularEnergia(sessao.meterStartWh, payload.meterStop);
    const duracao = this.calcularDuracao(sessao.startedAt, payload.timestamp);

    await this.prisma.chargingSession.update({
      where: { id: sessao.id },
      data: {
        status: 'COMPLETED',
        stoppedAt: payload.timestamp,
        meterStopWh: payload.meterStop,
        energyWh: energia.wh,
        durationSeconds: duracao,
        // A parada por teto chega do carregador como "Remote", igual a um
        // encerramento pelo painel. A marca gravada no disparo é o que distingue
        // os dois — sem ela, a conciliação não saberia quantas recargas foram
        // interrompidas por falta de saldo pré-autorizado.
        stopReason: sessao.ceilingReachedAt
          ? 'CEILING_REACHED'
          : this.mapStopReason(payload.reason),
        failureReason: energia.inconsistente
          ? `leitura final (${payload.meterStop} Wh) menor que a inicial (${sessao.meterStartWh} Wh)`
          : undefined,
      },
    });

    if (energia.inconsistente) {
      // Não inventamos energia negativa nem valor a cobrar. A sessão fica
      // marcada para revisão do operador.
      this.logger.error(
        {
          sessionId: sessao.id,
          meterStart: sessao.meterStartWh,
          meterStop: payload.meterStop,
          correlationId: ctx.correlationId,
        },
        'medição inconsistente: leitura final menor que a inicial',
      );
    }

    this.logger.log(
      {
        sessionId: sessao.id,
        transactionId: payload.transactionId,
        energyWh: energia.wh,
        durationSeconds: duracao,
        reason: payload.reason,
        correlationId: ctx.correlationId,
      },
      'recarga encerrada',
    );

    return { idTagInfo: { status: 'Accepted' } };
  }

  // -------------------------------------------------------------------------
  // MeterValues
  // -------------------------------------------------------------------------

  /**
   * Leituras periódicas do medidor.
   *
   * Guardamos todas as amostras cruas (para diagnóstico) e mantemos a energia
   * acumulada da sessão de forma **monotônica**: mensagens fora de ordem não
   * podem reduzir a energia registrada, porque isso reduziria o valor a cobrar.
   */
  async meterValues(
    payload: MeterValuesRequestType,
    ctx: HandlerContext,
  ): Promise<Record<string, never>> {
    const connector = await this.prisma.connector.findUnique({
      where: {
        chargerId_connectorNumber: {
          chargerId: ctx.chargerId,
          connectorNumber: payload.connectorId,
        },
      },
      select: { id: true },
    });

    const sessao = payload.transactionId
      ? await this.prisma.chargingSession.findFirst({
          where: { chargerId: ctx.chargerId, ocppTransactionId: payload.transactionId },
          select: {
            id: true,
            meterStartWh: true,
            energyWh: true,
            meterStopWh: true,
            idleSeconds: true,
            lastMeterAt: true,
          },
        })
      : null;

    const registros: Prisma.MeterValueCreateManyInput[] = [];
    let maiorLeitura: number | null = null;

    for (const entrada of payload.meterValue) {
      for (const amostra of entrada.sampledValue) {
        registros.push({
          sessionId: sessao?.id,
          chargerId: ctx.chargerId,
          connectorId: connector?.id,
          timestamp: entrada.timestamp,
          measurand: amostra.measurand ?? ENERGY_REGISTER,
          value: amostra.value,
          unit: amostra.unit,
          phase: amostra.phase,
          context: amostra.context,
          location: amostra.location,
          rawPayload: amostra as unknown as Prisma.InputJsonValue,
        });
      }

      try {
        const wh = extractEnergyWh(entrada.sampledValue);
        if (wh !== null && (maiorLeitura === null || wh > maiorLeitura)) maiorLeitura = wh;
      } catch (error) {
        // Leitura de energia inutilizável não pode descartar as outras amostras.
        this.logger.error(
          { err: error, chargerId: ctx.chargerId, correlationId: ctx.correlationId },
          'leitura de energia inválida em MeterValues',
        );
      }
    }

    if (registros.length > 0) {
      await this.prisma.meterValue.createMany({ data: registros });
    }

    await this.prisma.charger.update({
      where: { id: ctx.chargerId },
      data: { lastSeenAt: ctx.receivedAt, connectionStatus: 'ONLINE' },
    });

    if (sessao && maiorLeitura !== null && sessao.meterStartWh !== null) {
      // A leitura acumulada do medidor é absoluta; a energia da sessão é a
      // diferença desde o início.
      const energiaCandidata = Math.max(0, maiorLeitura - sessao.meterStartWh);
      const reconciliado = reconcileMeterReading(sessao.energyWh, energiaCandidata);

      // Leitura MENOR que a conhecida é mensagem atrasada; leitura IGUAL é
      // veículo parado. As duas voltam `foraDeOrdem`, mas só a primeira merece
      // alarme — a segunda é o caso normal de um carro que terminou de carregar.
      if (reconciliado.foraDeOrdem && energiaCandidata < (sessao.energyWh ?? 0)) {
        this.logger.warn(
          {
            sessionId: sessao.id,
            energiaAtual: sessao.energyWh,
            energiaRecebida: energiaCandidata,
            correlationId: ctx.correlationId,
          },
          'MeterValues fora de ordem — energia acumulada preservada',
        );
      }

      /**
       * A atualização é uma só, e acontece sempre.
       *
       * A medição de ociosidade ficava dentro do `else` e, com isso, nunca
       * rodava no caso que ela existe para detectar: energia que não sobe faz
       * `reconcileMeterReading` devolver `foraDeOrdem`. O veículo cheio caía
       * justamente no ramo que não media nada.
       */
      await this.prisma.chargingSession.update({
        where: { id: sessao.id },
        data: {
          energyWh: reconciliado.valor,
          ...this.medirOciosidade(sessao, reconciliado.valor, ctx.receivedAt),
        },
      });

      await this.verificarTeto(sessao.id, reconciliado.valor, ctx);
    }

    return {};
  }

  /**
   * Acumula o tempo em que o veículo ocupou o ponto sem carregar (FASE 6).
   *
   * A regra é simples e é a única possível com o que o protocolo dá: se a
   * energia acumulada não subiu desde a leitura anterior, o intervalo entre as
   * duas leituras foi ocioso.
   *
   * **Limite conhecido (risco R-30):** a resolução é a do intervalo de medição
   * do carregador. Um equipamento que reporta a cada 5 minutos produz
   * ociosidade em blocos de 5 minutos. Não há como ser mais fino do que o
   * equipamento informa, e inventar precisão seria pior do que assumir a
   * grossura.
   *
   * O primeiro MeterValues da sessão nunca conta como ocioso: não existe
   * intervalo anterior para medir, e assumir que existiu cobraria o motorista
   * por tempo que não aconteceu.
   */
  private medirOciosidade(
    sessao: { energyWh: number | null; idleSeconds: number; lastMeterAt: Date | null },
    energiaAgora: number,
    agora: Date,
  ): { idleSeconds?: Prisma.IntFieldUpdateOperationsInput; lastMeterAt?: Date } {
    if (sessao.lastMeterAt === null) {
      return { lastMeterAt: agora };
    }

    const subiu = energiaAgora > (sessao.energyWh ?? 0);
    if (subiu) {
      return { lastMeterAt: agora };
    }

    const intervalo = Math.max(
      0,
      Math.floor((agora.getTime() - sessao.lastMeterAt.getTime()) / 1000),
    );

    /**
     * Intervalo menor que um segundo: nada é creditado e `lastMeterAt` **não**
     * avança.
     *
     * Sem isso, o tempo abaixo de um segundo era truncado a zero e perdido a
     * cada leitura. Um carregador que reporta com frequência alta nunca
     * acumularia ociosidade nenhuma — o defeito apareceu no teste, com o
     * simulador medindo a cada 150 ms. Segurando o instante anterior, o resto
     * sobrevive para a leitura seguinte.
     */
    if (intervalo < 1) {
      return {};
    }

    /**
     * `increment`, e não `idleSeconds: lido + intervalo`.
     *
     * O somatório em código é ler-somar-escrever: duas medições processadas em
     * paralelo leem o mesmo valor e a segunda escrita apaga a primeira. O
     * incremento acontece dentro do UPDATE, no banco, e não tem esse buraco.
     *
     * Na prática o gateway serializa as mensagens de uma mesma conexão, mas
     * depender disso seria depender de um detalhe de outra camada para não
     * perder cobrança.
     */
    return { idleSeconds: { increment: intervalo }, lastMeterAt: agora };
  }

  /**
   * Parada automática ao atingir o teto (ADR-0008 §4, ADR-0010 §3) — risco R-22.
   *
   * É a proteção mais importante do modelo de pré-autorização: o adquirente
   * recusa capturar acima do valor reservado, então energia entregue além do
   * teto é prejuízo direto e não recuperável.
   *
   * Roda aqui, no MeterValues, porque é o único momento em que o consumo real
   * chega — e chega a cada poucos minutos. O worker de conciliação não serve:
   * uma varredura periódica atrasaria a decisão justamente quando o consumo está
   * mais rápido.
   */
  private async verificarTeto(
    sessionId: string,
    energyWh: number,
    ctx: HandlerContext,
  ): Promise<void> {
    const sessao = await this.prisma.chargingSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        status: true,
        startedAt: true,
        tariffSnapshot: true,
        idleSeconds: true,
        ceilingAmountCents: true,
        ceilingReachedAt: true,
        payment: { select: { method: true } },
      },
    });

    // Sem teto não há o que verificar: é o caso da recarga manual e da iniciada
    // no próprio carregador, que não têm valor reservado.
    if (!sessao?.ceilingAmountCents) return;
    if (sessao.status !== 'CHARGING') return;
    // Já disparada: o comando de parada está em andamento. Reenviar a cada
    // MeterValues encheria o carregador de comandos redundantes.
    if (sessao.ceilingReachedAt) return;

    const valorCorrente = this.pricing.runningAmount({ ...sessao, energyWh }, ctx.receivedAt);

    if (valorCorrente === null) return;

    const limiar = this.pricing.autoStopThreshold(
      sessao.ceilingAmountCents,
      sessao.payment?.method ?? null,
    );

    if (valorCorrente < limiar) return;

    /**
     * A marca é gravada ANTES de enviar o comando.
     *
     * Se fosse depois, um erro no envio deixaria a sessão sem marca e o próximo
     * MeterValues dispararia tudo de novo. Gravando antes, o pior caso é uma
     * sessão marcada cuja parada falhou — visível no painel e tratável — em vez
     * de uma enxurrada de comandos.
     */
    await this.prisma.chargingSession.update({
      where: { id: sessionId },
      data: { ceilingReachedAt: ctx.receivedAt },
    });

    this.logger.warn(
      {
        sessionId,
        valorCorrenteCents: valorCorrente,
        limiarCents: limiar,
        tetoCents: sessao.ceilingAmountCents,
        energyWh,
        correlationId: ctx.correlationId,
      },
      'teto atingido — encerrando a recarga automaticamente',
    );

    /**
     * O comando sai FORA deste handler, de propósito.
     *
     * Esperar aqui pela resposta do `RemoteStopTransaction` trava: o carregador
     * está bloqueado aguardando a resposta do MeterValues que estamos
     * processando, e nós ficaríamos aguardando a resposta do comando que ele não
     * vai processar enquanto não for respondido. Impasse dos dois lados.
     *
     * Descoberto em 2026-07-30 pelo teste da parada automática, que estourava o
     * tempo limite do MeterValues. Aconteceria igual com o WEMOB — o
     * enfileiramento por conexão é do protocolo, não do simulador.
     *
     * Então: respondemos o MeterValues primeiro e o comando parte em seguida.
     */
    void this.dispararParada(sessionId);
  }

  /** Envia a parada por teto sem prender o processamento da mensagem atual. */
  private async dispararParada(sessionId: string): Promise<void> {
    try {
      const comando = await this.commands.remoteStop({ sessionId });
      if (comando.accepted) return;

      // O carregador não parou. Continua consumindo acima do reservado, e o
      // excedente não será cobrável. Precisa de intervenção humana.
      this.logger.error(
        { sessionId, code: comando.code, message: comando.message },
        'PARADA AUTOMÁTICA FALHOU: consumo pode ultrapassar o valor pré-autorizado',
      );

      await this.prisma.chargingSession.update({
        where: { id: sessionId },
        data: {
          failureReason:
            'o teto foi atingido mas o carregador não aceitou o comando de parada: ' +
            comando.message,
        },
      });
    } catch (error) {
      this.logger.error(
        { err: error, sessionId },
        'PARADA AUTOMÁTICA FALHOU: erro ao enviar o comando de encerramento',
      );
    }
  }

  // -------------------------------------------------------------------------
  // Apoio
  // -------------------------------------------------------------------------

  /**
   * Próximo `transactionId` do OCPP, vindo de uma sequência do Postgres.
   *
   * A sequência garante unicidade sob concorrência sem transação explícita —
   * `nextval` nunca devolve o mesmo valor duas vezes.
   */
  private async nextTransactionId(): Promise<number> {
    const [linha] = await this.prisma.$queryRaw<{ id: bigint }[]>(
      Prisma.sql`SELECT nextval('ocpp_transaction_id_seq') AS id`,
    );

    return Number(linha.id);
  }

  /** Energia da sessão, tratando o caso de leitura final menor que a inicial. */
  private calcularEnergia(
    meterStartWh: number | null,
    meterStopWh: number,
  ): { wh: number | null; inconsistente: boolean } {
    if (meterStartWh === null) return { wh: null, inconsistente: false };

    if (meterStopWh < meterStartWh) {
      // Medidor reiniciado, troca de firmware ou leitura corrompida. Zero é
      // seguro: não cobramos energia que não sabemos se foi entregue.
      return { wh: 0, inconsistente: true };
    }

    return { wh: meterStopWh - meterStartWh, inconsistente: false };
  }

  private calcularDuracao(startedAt: Date | null, stoppedAt: Date): number | null {
    if (!startedAt) return null;

    const segundos = Math.round((stoppedAt.getTime() - startedAt.getTime()) / 1000);
    // Relógio do carregador adiantado em relação ao nosso produziria negativo.
    return Math.max(0, segundos);
  }

  /** Traduz o motivo do OCPP para o enum do domínio (briefing 11.8). */
  private mapStopReason(reason: string | undefined): StopReason {
    const mapa: Record<string, StopReason> = {
      Remote: 'REMOTE_STOP',
      Local: 'LOCAL_STOP',
      EVDisconnected: 'EV_DISCONNECTED',
      EmergencyStop: 'EMERGENCY_STOP',
      PowerLoss: 'POWER_LOSS',
      DeAuthorized: 'DE_AUTHORIZED',
      HardReset: 'CHARGER_FAULT',
      SoftReset: 'CHARGER_FAULT',
      Reboot: 'CHARGER_FAULT',
      UnlockCommand: 'LOCAL_STOP',
      Other: 'OTHER',
    };

    // Ausência de `reason` no OCPP 1.6 significa encerramento local normal.
    return reason ? (mapa[reason] ?? 'OTHER') : 'LOCAL_STOP';
  }

  /** Registra uma recarga iniciada fora da plataforma, para conciliação. */
  private async criarSessaoOrfa(
    payload: StartTransactionRequestType,
    ctx: HandlerContext,
    transactionId: number,
    connectorId: string | undefined,
  ): Promise<void> {
    const charger = await this.prisma.charger.findUnique({
      where: { id: ctx.chargerId },
      select: { siteId: true, site: { select: { organizationId: true } } },
    });

    if (!charger || !connectorId) {
      this.logger.error(
        { chargerId: ctx.chargerId, connectorId: payload.connectorId },
        'não foi possível registrar a sessão sem pagamento: carregador ou conector desconhecido',
      );
      return;
    }

    try {
      await this.prisma.chargingSession.create({
        data: {
          organizationId: charger.site.organizationId,
          siteId: charger.siteId,
          chargerId: ctx.chargerId,
          connectorId,
          ocppTransactionId: transactionId,
          idTag: payload.idTag,
          status: 'CHARGING' satisfies SessionStatus,
          startedAt: payload.timestamp,
          meterStartWh: payload.meterStart,
          failureReason: 'recarga iniciada no carregador, sem pagamento pela plataforma',
        },
      });
    } catch (error) {
      // Pode bater no índice de uma sessão ativa por conector (regra 11.1).
      this.logger.error(
        { err: error, chargerId: ctx.chargerId },
        'falha ao registrar sessão sem pagamento',
      );
    }
  }
}
