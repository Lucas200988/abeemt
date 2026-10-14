import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { runtimeEnv } from '../../config/runtime-env';
import { PaymentsService } from './payments.service';

/**
 * Worker que fecha o que ficou pendente.
 *
 * Existe porque as duas piores situações do produto acontecem **na ausência de
 * evento**, e nenhum handler é chamado quando nada acontece:
 *
 *  * o carregador não responde ao comando e a reserva fica presa no cartão;
 *  * a recarga termina e a captura falha porque o adquirente estava fora.
 *
 * Roda em intervalo, não em fila persistente. Uma fila seria mais robusta e é o
 * caminho depois do piloto; para um servidor único, um laço que varre o banco
 * tem a vantagem de se recuperar sozinho de qualquer reinício — o estado está
 * todo no banco, não na memória.
 */
@Injectable()
export class SessionWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private rodando = false;

  /**
   * Falhas consecutivas por sessão, para espaçar as tentativas de captura.
   *
   * Em memória de propósito: reiniciar o processo zera a contagem e volta a
   * tentar, que é exatamente o comportamento desejado quando há dinheiro a
   * receber.
   */
  private readonly falhas = new Map<string, { tentativas: number; proximaTentativaEm: number }>();

  /**
   * Margem sobre o prazo da regra 11.5 antes de o worker intervir.
   *
   * O `remoteStart` já espera 120 segundos pela resposta do carregador. Sem esta
   * folga, o worker expiraria a sessão enquanto o comando ainda está em voo e as
   * duas rotinas escreveriam estados contraditórios na mesma linha. O worker é
   * rede de segurança — para o caso de o processo ter reiniciado no meio —, não
   * concorrente do caminho normal.
   */
  private static readonly MARGEM_MS = 30_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
  ) {}

  onModuleInit(): void {
    // Nos testes o laço é dirigido manualmente por `tick()`: um timer solto
    // deixa o vitest pendurado e produz falha intermitente.
    if (runtimeEnv.NODE_ENV === 'test') return;

    const intervalo = runtimeEnv.BORA_SETTLEMENT_INTERVAL_SECONDS * 1000;
    this.timer = setInterval(() => void this.tick(), intervalo);
    // Não segura o processo no ar durante o desligamento.
    this.timer.unref();

    this.logger.log({ intervaloSegundos: intervalo / 1000 }, 'worker de sessões iniciado');
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Uma passada completa. Público para que os testes controlem o tempo. */
  async tick(agora = new Date()): Promise<{
    semPagamento: number;
    aguardandoCarregador: number;
    aguardandoVeiculo: number;
    fechadas: number;
  }> {
    // Sem sobreposição: uma passada lenta não pode iniciar a seguinte, ou duas
    // capturas do mesmo pagamento sairiam ao mesmo tempo.
    if (this.rodando) {
      return { semPagamento: 0, aguardandoCarregador: 0, aguardandoVeiculo: 0, fechadas: 0 };
    }

    this.rodando = true;
    try {
      const semPagamento = await this.expirarSemPagamento(agora);
      const aguardandoCarregador = await this.expirarSemResposta(agora);
      const aguardandoVeiculo = await this.expirarSemInicio(agora);
      const fechadas = await this.fecharPendentes(agora);

      return { semPagamento, aguardandoCarregador, aguardandoVeiculo, fechadas };
    } finally {
      this.rodando = false;
    }
  }

  /**
   * Sessões que travaram esperando o pagamento.
   *
   * Existe por causa de uma consequência direta da migration
   * `20260730080000_awaiting_payment_ocupa_conector`: `AWAITING_PAYMENT` passou a
   * ocupar o conector, o que é o que impede dois motoristas de pagarem pelo mesmo
   * ponto — mas também significa que um pagamento interrompido no meio (processo
   * derrubado entre criar a sessão e receber a resposta do adquirente) bloqueia o
   * conector para sempre. Esta varredura é o que fecha essa porta.
   */
  private async expirarSemPagamento(agora: Date): Promise<number> {
    const limite = new Date(
      agora.getTime() -
        runtimeEnv.BORA_CHARGER_ACCEPT_TIMEOUT_SECONDS * 1000 -
        SessionWorker.MARGEM_MS,
    );

    const presas = await this.prisma.chargingSession.findMany({
      where: { status: 'AWAITING_PAYMENT', requestedAt: { lt: limite } },
      select: { id: true },
      take: 50,
    });

    for (const sessao of presas) {
      // FAILED, não EXPIRED: aqui o pagamento nem chegou a se concluir, e a
      // distinção importa para a conciliação.
      await this.prisma.chargingSession.update({
        where: { id: sessao.id },
        data: {
          status: 'FAILED',
          stoppedAt: agora,
          failureReason: 'o pagamento não se concluiu — conector liberado',
        },
      });

      try {
        await this.payments.voidSessionPayment(sessao.id, 'pagamento não concluído');
      } catch (error) {
        this.logger.error(
          { err: error, sessionId: sessao.id },
          'não foi possível cancelar a reserva de uma sessão sem pagamento concluído',
        );
      }

      this.logger.warn({ sessionId: sessao.id }, 'sessão liberada: pagamento não se concluiu');
    }

    return presas.length;
  }

  /**
   * Regra 11.5, primeira metade: o carregador tem 120 segundos para aceitar.
   *
   * Alcança as sessões que ficaram em `PAYMENT_APPROVED` ou `COMMAND_SENT` —
   * pagas, com o valor reservado, e sem o equipamento ter dito nada.
   */
  private async expirarSemResposta(agora: Date): Promise<number> {
    const limite = new Date(
      agora.getTime() -
        runtimeEnv.BORA_CHARGER_ACCEPT_TIMEOUT_SECONDS * 1000 -
        SessionWorker.MARGEM_MS,
    );

    const presas = await this.prisma.chargingSession.findMany({
      where: {
        status: { in: ['PAYMENT_APPROVED', 'AWAITING_CHARGER', 'COMMAND_SENT'] },
        authorizedAt: { lt: limite },
      },
      select: { id: true },
      take: 50,
    });

    for (const sessao of presas) {
      await this.encerrar(
        sessao.id,
        'EXPIRED',
        'o carregador não respondeu ao comando de início dentro do prazo',
      );
    }

    return presas.length;
  }

  /**
   * Regra 11.5, segunda metade: o veículo tem 5 minutos para começar.
   *
   * O comando foi aceito (`STARTING`) mas o `StartTransaction` nunca chegou —
   * cabo não conectado, veículo recusando a carga, ou o motorista desistiu.
   */
  private async expirarSemInicio(agora: Date): Promise<number> {
    const limite = new Date(agora.getTime() - runtimeEnv.BORA_VEHICLE_START_TIMEOUT_SECONDS * 1000);

    const presas = await this.prisma.chargingSession.findMany({
      where: {
        status: 'STARTING',
        ocppTransactionId: null,
        commandSentAt: { lt: limite },
      },
      select: { id: true },
      take: 50,
    });

    for (const sessao of presas) {
      await this.encerrar(
        sessao.id,
        'EXPIRED',
        'a recarga não começou dentro do prazo — verifique se o cabo estava conectado',
      );
    }

    return presas.length;
  }

  /**
   * Sessões encerradas cujo valor ainda não foi cobrado.
   *
   * A varredura é a rede de segurança do risco R-23: enquanto o valor final não
   * estiver gravado, o worker volta a tentar. Uma indisponibilidade do
   * adquirente atrasa a cobrança, não a perde.
   */
  private async fecharPendentes(agora: Date): Promise<number> {
    const pendentes = await this.prisma.chargingSession.findMany({
      where: {
        stoppedAt: { not: null },
        finalAmountCents: null,
        status: { in: ['COMPLETED', 'CANCELLED', 'FAILED', 'EXPIRED', 'DECLINED'] },
      },
      select: { id: true },
      orderBy: { stoppedAt: 'asc' },
      take: 50,
    });

    let fechadas = 0;

    for (const sessao of pendentes) {
      const falha = this.falhas.get(sessao.id);
      if (falha && agora.getTime() < falha.proximaTentativaEm) continue;

      try {
        const resultado = await this.payments.settleSession(sessao.id);
        if (resultado.settled) {
          fechadas += 1;
          this.falhas.delete(sessao.id);
        }
      } catch (error) {
        this.adiarTentativa(sessao.id, agora);

        // Erro, não warn: energia entregue e não cobrada precisa aparecer no
        // alerta, não sumir no meio dos logs.
        this.logger.error(
          { err: error, sessionId: sessao.id, tentativas: this.falhas.get(sessao.id)?.tentativas },
          'falha ao fechar a sessão — será tentado de novo',
        );
      }
    }

    return fechadas;
  }

  /**
   * Espaçamento exponencial entre tentativas, com teto.
   *
   * Sem isso, um pagamento que falha por motivo permanente seria tentado a cada
   * ciclo, para sempre, enchendo o log e escondendo os casos recuperáveis. Com
   * teto porque desistir não é opção: há dinheiro a receber.
   */
  private adiarTentativa(sessionId: string, agora: Date): void {
    const tentativas = (this.falhas.get(sessionId)?.tentativas ?? 0) + 1;
    const ciclos = Math.min(2 ** (tentativas - 1), 60);

    this.falhas.set(sessionId, {
      tentativas,
      proximaTentativaEm:
        agora.getTime() + ciclos * runtimeEnv.BORA_SETTLEMENT_INTERVAL_SECONDS * 1000,
    });
  }

  /** Encerra a sessão e desfaz a reserva, nesta ordem. */
  private async encerrar(sessionId: string, status: 'EXPIRED', motivo: string): Promise<void> {
    await this.prisma.chargingSession.update({
      where: { id: sessionId },
      data: { status, stoppedAt: new Date(), failureReason: motivo },
    });

    try {
      await this.payments.voidSessionPayment(sessionId, motivo);
    } catch (error) {
      this.logger.error(
        { err: error, sessionId },
        'sessão expirada, mas a reserva não pôde ser cancelada — verificar no adquirente',
      );
    }

    this.logger.warn({ sessionId, motivo }, 'sessão expirada pelo worker');
  }
}
