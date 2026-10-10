package br.com.sonare.bora.pos.dominio

import br.com.sonare.bora.pos.api.BoraApi
import br.com.sonare.bora.pos.api.CofreDeToken
import br.com.sonare.bora.pos.api.ContextoTerminal
import br.com.sonare.bora.pos.api.PedidoAutorizacao
import br.com.sonare.bora.pos.api.PedidoEncerramento
import br.com.sonare.bora.pos.api.PedidoHeartbeat
import br.com.sonare.bora.pos.api.PedidoPareamento
import br.com.sonare.bora.pos.api.PedidoResultadoCaptura
import br.com.sonare.bora.pos.api.PedidoResultadoDevolucao
import br.com.sonare.bora.pos.api.SessaoTerminal
import br.com.sonare.bora.pos.pagamento.PagamentoPort
import br.com.sonare.bora.pos.pagamento.ReferenciaPreAutorizacao
import br.com.sonare.bora.pos.pagamento.ResultadoPagamento
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import java.io.IOException
import java.util.UUID

/**
 * A máquina de estados da maquininha — o fluxo inteiro do motorista:
 *
 *   INICIANDO → PAREAMENTO → PRONTA ("conecte o cabo")
 *             → COBRANÇA ("aproxime o cartão", o SDK reserva o teto)
 *             → REGISTRANDO (POST /terminal/authorization; o backend liga o carregador)
 *             → CARREGANDO (kWh e valor ao vivo; botão encerrar)
 *             → ENCERRADA (resumo) → PRONTA de novo.
 *
 * Sem Android aqui dentro: esta classe só conhece a API, o cofre e a
 * PagamentoPort. A MainActivity observa `tela` e desenha — o que permite
 * testar o fluxo em JVM pura quando os testes chegarem.
 */
class FluxoRecarga(
  private val api: BoraApi,
  private val cofre: CofreDeToken,
  private val pagamento: PagamentoPort,
  private val escopo: CoroutineScope,
  private val versaoApp: String,
  /** Build.MODEL / Build.SERIAL, injetados para esta classe não depender de Android. */
  private val modeloEquipamento: String? = null,
  private val serieEquipamento: String? = null,
) {

  sealed class Tela {
    object Iniciando : Tela()
    data class Pareamento(val emAndamento: Boolean, val erro: String? = null) : Tela()
    data class Pronta(val contexto: ContextoTerminal) : Tela()
    /** Débito/Pix: o motorista escolhe quanto pagar entre as opções do servidor. */
    data class EscolhaValor(val metodo: String, val opcoesCents: List<Long>) : Tela()
    data class Cobranca(
      val valorCents: Long,
      val mensagemDoCartao: String? = null,
      val metodo: String = "CREDIT_CARD",
    ) : Tela()
    object Registrando : Tela()
    data class Carregando(val sessao: SessaoTerminal, val encerrando: Boolean = false) : Tela()
    data class Encerrada(val sessao: SessaoTerminal) : Tela()
    data class Erro(val mensagem: String) : Tela()
  }

  private val _tela = MutableStateFlow<Tela>(Tela.Iniciando)
  val tela: StateFlow<Tela> = _tela

  private var contextoAtual: ContextoTerminal? = null
  private var trabalhoAtual: Job? = null

  /** Lido pela thread do SDK (mensagens) e pela corrotina da cobrança. */
  @Volatile private var cobrancaCancelada = false

  // -------------------------------------------------------------------------
  // Entrada
  // -------------------------------------------------------------------------

  /** Chamado no onCreate. Decide entre pareamento e operação normal. */
  fun iniciar() {
    trocarTrabalho {
      if (cofre.token() == null) {
        _tela.value = Tela.Pareamento(emAndamento = false)
      } else {
        carregarContexto()
      }
    }
    ligarHeartbeat()
  }

  fun parear(codigo: String) {
    val limpo = codigo.trim().uppercase()
    if (limpo.length < 6) {
      _tela.value = Tela.Pareamento(emAndamento = false, erro = "Código muito curto.")
      return
    }
    trocarTrabalho {
      _tela.value = Tela.Pareamento(emAndamento = true)
      try {
        val resposta = api.parear(
          PedidoPareamento(
            pairingCode = limpo,
            model = modeloEquipamento,
            serialNumber = serieEquipamento,
            appVersion = versaoApp,
          ),
        )
        val corpo = resposta.body()
        if (resposta.isSuccessful && corpo != null) {
          // O token só passa por aqui UMA vez — direto para o cofre cifrado.
          cofre.guardarToken(corpo.token)
          carregarContexto()
        } else {
          _tela.value = Tela.Pareamento(emAndamento = false, erro = "Código inválido ou expirado. Gere outro no painel.")
        }
      } catch (e: IOException) {
        _tela.value = Tela.Pareamento(emAndamento = false, erro = "Sem conexão com o servidor.")
      }
    }
  }

  fun tentarDeNovo() = iniciar()

  // -------------------------------------------------------------------------
  // PRONTA → COBRANÇA → REGISTRANDO → CARREGANDO
  // -------------------------------------------------------------------------

  fun iniciarRecarga() {
    val contexto = contextoAtual ?: return
    // O valor da reserva vem do servidor, nunca daqui (fase-8 §3.2).
    val valor = contexto.preAuthAmountCents

    cobrancaCancelada = false
    trocarTrabalho {
      _tela.value = Tela.Cobranca(valor)
      // As instruções do SDK ("INSIRA O CARTÃO"…) chegam de outra thread;
      // atribuir StateFlow.value é seguro a partir de qualquer uma.
      val aoMensagem = { mensagem: String ->
        if (_tela.value is Tela.Cobranca && !cobrancaCancelada) {
          _tela.value = Tela.Cobranca(valor, mensagem)
        }
      }
      val resultado = pagamento.preAutorizar(valor, aoMensagem)

      concluirCobranca(resultado, valor)
    }
  }

  /**
   * Débito ou Pix: antes de cobrar, o motorista escolhe quanto. As opções vêm
   * do servidor (`prepaidOptionsCents`) — o app nunca inventa um valor.
   */
  fun escolherPrePago(metodo: String) {
    val contexto = contextoAtual ?: return
    val opcoes = contexto.prepaidOptionsCents.orEmpty()
    trabalhoAtual?.cancel()
    _tela.value = if (opcoes.isEmpty()) {
      Tela.Erro("Este ponto não aceita $metodo no momento. Use o cartão de crédito.")
    } else {
      Tela.EscolhaValor(metodo, opcoes)
    }
  }

  fun voltarParaPronta() {
    trocarTrabalho { carregarContexto() }
  }

  /** O motorista escolheu o valor: venda imediata no débito/Pix (ADR-0010). */
  fun pagarValorFixo(valorCents: Long) {
    val escolha = _tela.value as? Tela.EscolhaValor ?: return
    // Defesa em profundidade: só os valores publicados pelo servidor passam.
    if (valorCents !in escolha.opcoesCents) return

    cobrancaCancelada = false
    trocarTrabalho {
      _tela.value = Tela.Cobranca(valorCents, metodo = escolha.metodo)
      val aoMensagem = { mensagem: String ->
        if (_tela.value is Tela.Cobranca && !cobrancaCancelada) {
          _tela.value = Tela.Cobranca(valorCents, mensagem, escolha.metodo)
        }
      }
      val resultado = pagamento.cobrarValorFixo(escolha.metodo, valorCents, aoMensagem)
      concluirCobranca(resultado, valorCents)
    }
  }

  /** O que acontece depois que o SDK devolve — igual para reserva e venda. */
  private suspend fun concluirCobranca(resultado: ResultadoPagamento, valorCents: Long) {
    if (cobrancaCancelada) {
      // Cartão aproximado no mesmo instante do cancelamento: saiu aprovado, mas
      // o motorista desistiu. Desfaz já — no crédito o valor ficaria preso no
      // limite até expirar; no pré-pago o dinheiro já saiu.
      if (resultado is ResultadoPagamento.Aprovado) {
        val desfeito = desfazerPagamento(resultado, valorCents)
        if (desfeito !is ResultadoPagamento.Aprovado) {
          _tela.value = Tela.Erro(
            "O pagamento foi feito, mas o cancelamento falhou. Procure o operador para a devolução.",
          )
          return
        }
      }
      carregarContexto()
      return
    }

    when (resultado) {
      is ResultadoPagamento.Aprovado -> registrarNoBackend(resultado, valorCents)
      is ResultadoPagamento.Recusado -> _tela.value = Tela.Erro(resultado.mensagem)
      is ResultadoPagamento.Falha -> _tela.value = Tela.Erro(resultado.mensagem)
    }
  }

  /**
   * Desfaz um pagamento que não vai virar recarga: cancela a reserva (crédito)
   * ou estorna a venda (débito/Pix) — o SDK trata os dois de forma diferente.
   */
  private suspend fun desfazerPagamento(
    aprovado: ResultadoPagamento.Aprovado,
    valorCents: Long,
  ): ResultadoPagamento =
    if (ehPrePago(aprovado.metodo)) {
      pagamento.estornar(aprovado.referencia, aprovado.metodo, valorCents)
    } else {
      pagamento.cancelarPreAutorizacao(aprovado.referencia)
    }

  private fun ehPrePago(metodo: String?) = metodo == "DEBIT_CARD" || metodo == "PIX"

  /**
   * O motorista desistiu na tela do cartão.
   *
   * Trocar de tela não basta: o SDK continua esperando o cartão e a próxima
   * recarga recebe "serviço ocupado" (terminal DEBUG, 2026-10-10). Aborta no
   * equipamento e deixa o `preAutorizar` em curso retornar — é ele quem volta
   * para a tela PRONTA, depois de desfazer uma eventual aprovação simultânea.
   */
  fun cancelarCobranca() {
    val atual = _tela.value as? Tela.Cobranca ?: return
    cobrancaCancelada = true
    _tela.value = atual.copy(mensagemDoCartao = "Cancelando…")
    escopo.launch {
      pagamento.abortar()
      // Último recurso, se o SDK não devolver a chamada: volta à tela inicial
      // mesmo assim (a próxima cobrança espera o serviço liberar).
      delay(ESPERA_MAXIMA_ABORTO_MS)
      if (cobrancaCancelada && _tela.value is Tela.Cobranca) {
        trocarTrabalho { carregarContexto() }
      }
    }
  }

  /**
   * O cartão aprovou; agora o backend precisa saber — e ligar o carregador.
   *
   * A chave de idempotência é criada ANTES do primeiro envio e persistida no
   * cofre. Se o app morrer com a resposta no ar, ao religar reenviamos com a
   * MESMA chave e recebemos o MESMO pagamento — nunca uma cobrança dupla.
   */
  private suspend fun registrarNoBackend(aprovado: ResultadoPagamento.Aprovado, valorCents: Long) {
    _tela.value = Tela.Registrando

    val chave = cofre.chaveIdempotenciaPendente() ?: UUID.randomUUID().toString().also {
      cofre.guardarChaveIdempotencia(it)
    }

    val pedido = PedidoAutorizacao(
      providerPaymentId = aprovado.referencia.providerPaymentId,
      method = aprovado.metodo,
      amountAuthorizedCents = valorCents,
      idempotencyKey = chave,
      cardBrand = aprovado.cardBrand,
      cardLastFour = aprovado.cardLastFour,
      nsu = aprovado.nsu,
      authorizationCode = aprovado.authorizationCode,
    )

    var ultimaFalha = "Sem conexão com o servidor."
    repeat(3) { tentativa ->
      try {
        val resposta = api.registrarAutorizacao(pedido)
        val corpo = resposta.body()
        if (resposta.isSuccessful && corpo != null) {
          cofre.limparChaveIdempotencia()
          if (corpo.approved && corpo.sessionId != null) {
            // Guardada ANTES de seguir: se o backend pedir a captura no
            // equipamento horas depois (pendingCapture), é ela que diz ao SDK
            // qual reserva efetivar — mesmo que o app tenha reiniciado.
            cofre.guardarReferenciaDaSessao(
              corpo.sessionId,
              aprovado.referencia.providerPaymentId,
              aprovado.referencia.transactionId,
              aprovado.referencia.transactionCode,
            )
            acompanharSessao(corpo.sessionId)
          } else {
            // O backend recusou a sessão (conector ocupado, teto…). O dinheiro
            // está reservado — ou já saiu, no pré-pago — à toa: desfaz JÁ.
            desfazerPagamento(aprovado, valorCents)
            _tela.value = Tela.Erro(corpo.message ?: "A recarga não pôde começar. Nada foi cobrado.")
          }
          return
        }
        // 4xx: o backend explicou o motivo; retentar não muda nada.
        ultimaFalha = "O servidor recusou a autorização (${resposta.code()})."
        if (resposta.code() in 400..499) {
          desfazerPagamento(aprovado, valorCents)
          _tela.value = Tela.Erro(ultimaFalha)
          return
        }
      } catch (e: IOException) {
        ultimaFalha = "Sem conexão com o servidor."
      }
      delay(2000L * (tentativa + 1))
    }

    // Três tentativas sem resposta — desfecho DESCONHECIDO: o backend pode ter
    // recebido e iniciado a sessão. Por isso NÃO cancelamos a pré-autorização
    // aqui (mataria a reserva de uma recarga em andamento). A chave de
    // idempotência fica no cofre, e "tentar de novo" recarrega o contexto:
    // se a sessão começou, o app retoma a tela CARREGANDO por activeSessionId.
    _tela.value = Tela.Erro("$ultimaFalha Toque em tentar de novo.")
  }

  // -------------------------------------------------------------------------
  // CARREGANDO
  // -------------------------------------------------------------------------

  fun encerrarRecarga() {
    val atual = _tela.value as? Tela.Carregando ?: return
    trocarTrabalho {
      _tela.value = atual.copy(encerrando = true)
      try {
        val resposta = api.encerrar(
          atual.sessao.sessionId,
          PedidoEncerramento(reason = "motorista encerrou na maquininha"),
        )
        val corpo = resposta.body()
        val aceito = resposta.isSuccessful && (corpo?.command?.accepted ?: false)
        if (!aceito) {
          // Encerramento recusado (carregador offline, sessão que acabou de
          // começar…): o botão VOLTA e o motivo fica na tela por alguns
          // segundos. Deixar "Encerrando…" travado era o defeito visto no
          // terminal DEBUG em 2026-10-10 — num totem, botão sem saída é
          // motorista preso.
          val motivo = corpo?.command?.message ?: "Não foi possível encerrar agora (${resposta.code()})."
          _tela.value = Tela.Carregando((corpo ?: atual.sessao).copy(message = motivo), encerrando = false)
          delay(4000)
        }
      } catch (e: IOException) {
        // O stop se perdeu na rede; o acompanhamento abaixo mostra o estado
        // real — com o botão liberado para tentar de novo.
        _tela.value = atual.copy(encerrando = false)
      }
      acompanharSessao(atual.sessao.sessionId)
    }
  }

  fun novaRecarga() {
    trocarTrabalho { carregarContexto() }
  }

  /**
   * Poll do estado a cada 5 s até a sessão deixar de estar ativa — e, quando o
   * backend publicar uma captura pendente (`pendingCapture`), executá-la no
   * SDK e confirmar. É a segunda metade do circuito dos provedores com captura
   * no equipamento (PlugPag): sem isto, a recarga terminaria sem cobrança.
   */
  private suspend fun acompanharSessao(sessionId: String) {
    var tentativasDeCaptura = 0
    var tentativasDeDevolucao = 0
    var encerradaDesde: Long? = null

    while (escopo.isActive) {
      try {
        val resposta = api.sessao(sessionId)
        val sessao = resposta.body()
        if (resposta.code() == 401) return aoTokenRevogado()
        if (resposta.isSuccessful && sessao != null) {
          val pendencia = sessao.pendingCapture
          if (!sessao.active && pendencia != null && tentativasDeCaptura < 5) {
            tentativasDeCaptura += 1
            resolverCapturaPendente(sessionId, pendencia.amountCents)
            // Volta ao topo: o próximo GET mostra a pendência resolvida (ou
            // mantida, se falhou — aí tenta de novo, até 5 vezes).
            delay(1500)
            continue
          }
          val devolucao = sessao.pendingRefund
          if (!sessao.active && devolucao != null && tentativasDeDevolucao < 5) {
            tentativasDeDevolucao += 1
            resolverDevolucaoPendente(sessionId, devolucao.amountCents, sessao.paymentMethod)
            delay(1500)
            continue
          }
          if (!sessao.active) {
            _tela.value = Tela.Encerrada(sessao)

            // A sessão fica inativa ANTES de a conciliação congelar o valor
            // (o worker roda a cada BORA_SETTLEMENT_INTERVAL_SECONDS). Nesse
            // intervalo não há pendência ainda — e encerrar aqui deixaria a
            // captura publicada logo depois sem ninguém para executá-la. Só
            // está fechada quando o valor foi decidido E nada espera o terminal.
            val cobrancaFechada =
              pendencia == null && devolucao == null && sessao.finalAmountCents != null
            if (cobrancaFechada) {
              cofre.limparReferenciaDaSessao(sessionId)
              return
            }

            // Espera limitada: sessão que nunca vai ser conciliada (falha antes
            // de começar, sem valor a fechar) não pode prender a tela para
            // sempre. A referência FICA guardada — se a pendência aparecer
            // depois, o /terminal/me (pendingCaptureSessionId) a devolve.
            val desde = encerradaDesde ?: System.currentTimeMillis().also { encerradaDesde = it }
            if (System.currentTimeMillis() - desde > ESPERA_MAXIMA_CONCILIACAO_MS) return
            delay(3000)
            continue
          }
          val encerrando = (_tela.value as? Tela.Carregando)?.encerrando ?: false
          _tela.value = Tela.Carregando(sessao, encerrando)
        }
      } catch (e: IOException) {
        // Rede oscilou; a tela segura o último estado e o loop tenta de novo.
      }
      delay(5000)
    }
  }

  /**
   * Executa no SDK o que o backend pediu — efetivar (valor > 0) ou cancelar a
   * reserva (valor 0) — e confirma o resultado. O VALOR vem do servidor,
   * nunca daqui: o terminal executa, mas não decide (fase-8 §4).
   */
  private suspend fun resolverCapturaPendente(sessionId: String, valorCents: Long) {
    val guardada = cofre.referenciaDaSessao(sessionId)
    if (guardada == null) {
      // Sem referência local (app reinstalado?): o SDK não sabe qual reserva
      // mexer. Reporta a falha para a pendência ficar visível no painel.
      try {
        api.resultadoCaptura(
          sessionId,
          PedidoResultadoCaptura(success = false, errorMessage = "terminal sem a referência da pré-autorização"),
        )
      } catch (e: IOException) {
        // O próximo ciclo tenta de novo.
      }
      return
    }

    val (providerPaymentId, transactionId, transactionCode) = guardada
    val referencia = ReferenciaPreAutorizacao(
      providerPaymentId = providerPaymentId,
      transactionId = transactionId,
      transactionCode = transactionCode,
    )

    val resultado = if (valorCents > 0) {
      pagamento.efetivar(referencia, valorCents)
    } else {
      pagamento.cancelarPreAutorizacao(referencia)
    }

    try {
      when (resultado) {
        is ResultadoPagamento.Aprovado -> api.resultadoCaptura(
          sessionId,
          PedidoResultadoCaptura(
            success = true,
            amountCapturedCents = valorCents,
            nsu = resultado.nsu,
            authorizationCode = resultado.authorizationCode,
          ),
        )
        is ResultadoPagamento.Recusado -> api.resultadoCaptura(
          sessionId,
          PedidoResultadoCaptura(success = false, errorMessage = resultado.mensagem),
        )
        is ResultadoPagamento.Falha -> api.resultadoCaptura(
          sessionId,
          PedidoResultadoCaptura(success = false, errorMessage = resultado.mensagem),
        )
      }
    } catch (e: IOException) {
      // Confirmação perdida na rede: a pendência continua publicada e o
      // próximo ciclo do poll resolve — o backend é idempotente.
    }
  }

  /**
   * Devolução integral de um pré-pago sem energia (ADR-0010 §4), executada no
   * SDK e confirmada ao backend. Com limite de tempo: o estorno de cartão
   * pode pedir o cartão de novo no equipamento — se o motorista já foi embora,
   * aborta, reporta a falha e a pendência fica visível no painel para o
   * operador devolver pela retaguarda.
   */
  private suspend fun resolverDevolucaoPendente(sessionId: String, valorCents: Long, metodo: String?) {
    val guardada = cofre.referenciaDaSessao(sessionId)
    if (guardada == null) {
      reportarDevolucao(sessionId, PedidoResultadoDevolucao(success = false, errorMessage = "terminal sem a referência do pagamento"))
      return
    }
    val (providerPaymentId, transactionId, transactionCode) = guardada
    val referencia = ReferenciaPreAutorizacao(
      providerPaymentId = providerPaymentId,
      transactionId = transactionId,
      transactionCode = transactionCode,
    )

    val resultado = withTimeoutOrNull(ESPERA_MAXIMA_ESTORNO_MS) {
      pagamento.estornar(referencia, metodo ?: "DEBIT_CARD", valorCents)
    }
    if (resultado == null) pagamento.abortar()

    val pedido = when (resultado) {
      is ResultadoPagamento.Aprovado -> PedidoResultadoDevolucao(success = true, amountRefundedCents = valorCents)
      is ResultadoPagamento.Recusado -> PedidoResultadoDevolucao(success = false, errorMessage = resultado.mensagem)
      is ResultadoPagamento.Falha -> PedidoResultadoDevolucao(success = false, errorMessage = resultado.mensagem)
      null -> PedidoResultadoDevolucao(success = false, errorMessage = "tempo esgotado no estorno")
    }
    reportarDevolucao(sessionId, pedido)
  }

  private suspend fun reportarDevolucao(sessionId: String, pedido: PedidoResultadoDevolucao) {
    try {
      api.resultadoDevolucao(sessionId, pedido)
    } catch (e: IOException) {
      // Confirmação perdida na rede: a pendência continua publicada e o
      // próximo ciclo do poll resolve — o backend é idempotente.
    }
  }

  // -------------------------------------------------------------------------
  // Apoio
  // -------------------------------------------------------------------------

  private suspend fun carregarContexto() {
    _tela.value = Tela.Iniciando
    try {
      val resposta = api.contexto()
      if (resposta.code() == 401) return aoTokenRevogado()
      val contexto = resposta.body()
      if (resposta.isSuccessful && contexto != null) {
        contextoAtual = contexto
        val ativa = contexto.activeSessionId
        val comCapturaPendente = contexto.pendingCaptureSessionId ?: contexto.pendingRefundSessionId
        if (ativa != null) {
          // O app reabriu no meio de uma recarga: volta direto para a tela dela.
          acompanharSessao(ativa)
        } else if (comCapturaPendente != null) {
          // O app reiniciou DEPOIS do fim da recarga mas ANTES de efetivar a
          // cobrança no SDK: resolve a pendência antes de aceitar recarga nova.
          acompanharSessao(comCapturaPendente)
        } else {
          _tela.value = Tela.Pronta(contexto)
          manterTelaProntaAtualizada()
        }
      } else {
        _tela.value = Tela.Erro("O servidor respondeu ${resposta.code()}.")
      }
    } catch (e: IOException) {
      _tela.value = Tela.Erro("Sem conexão com o servidor. Verifique a internet do equipamento.")
    }
  }

  /**
   * Recarrega o contexto enquanto a tela PRONTA estiver à vista.
   *
   * Sem isto, o estado do carregador era lido uma vez só: carregador que
   * estava desligado na hora deixava a maquininha presa em "indisponível" até
   * alguém reiniciar o app — num poste sem ninguém por perto. Também pega
   * preço ou teto alterados no painel. Roda dentro do trabalho corrente, então
   * apertar "Iniciar" (trocarTrabalho) o encerra sozinho.
   */
  private suspend fun manterTelaProntaAtualizada() {
    while (escopo.isActive && _tela.value is Tela.Pronta) {
      delay(INTERVALO_ATUALIZACAO_PRONTA_MS)
      try {
        val resposta = api.contexto()
        if (resposta.code() == 401) return aoTokenRevogado()
        val contexto = resposta.body() ?: continue
        if (!resposta.isSuccessful || _tela.value !is Tela.Pronta) continue
        contextoAtual = contexto
        val ativa = contexto.activeSessionId
          ?: contexto.pendingCaptureSessionId
          ?: contexto.pendingRefundSessionId
        if (ativa != null) return acompanharSessao(ativa)
        _tela.value = Tela.Pronta(contexto)
      } catch (e: IOException) {
        // Rede oscilou: a tela segura o último estado e tenta no próximo ciclo.
      }
    }
  }

  /** Token revogado no painel: só resta parear de novo. */
  private fun aoTokenRevogado() {
    cofre.esquecerToken()
    _tela.value = Tela.Pareamento(emAndamento = false, erro = "Terminal desativado no painel. Pareie de novo.")
  }

  /** Alimenta o "visto por último" do painel — terminal mudo aparece lá. */
  private fun ligarHeartbeat() {
    escopo.launch {
      while (isActive) {
        delay(60_000)
        if (cofre.token() != null) {
          try {
            api.heartbeat(PedidoHeartbeat(appVersion = versaoApp))
          } catch (e: IOException) {
            // Silêncio: o próximo batimento tenta de novo.
          }
        }
      }
    }
  }

  /** Cancela o trabalho corrente e lança o próximo — nunca dois fluxos ao mesmo tempo. */
  private fun trocarTrabalho(bloco: suspend () -> Unit) {
    trabalhoAtual?.cancel()
    trabalhoAtual = escopo.launch { bloco() }
  }

  private companion object {
    /** Folga sobre o ciclo da conciliação (15 s por padrão) mais a efetivação no SDK. */
    const val ESPERA_MAXIMA_CONCILIACAO_MS = 3 * 60_000L
    const val INTERVALO_ATUALIZACAO_PRONTA_MS = 15_000L
    const val ESPERA_MAXIMA_ABORTO_MS = 10_000L
    /** Estorno que pede o cartão de volta não pode prender a maquininha para sempre. */
    const val ESPERA_MAXIMA_ESTORNO_MS = 90_000L
  }
}
