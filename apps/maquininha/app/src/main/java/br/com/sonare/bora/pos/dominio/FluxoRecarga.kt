package br.com.sonare.bora.pos.dominio

import br.com.sonare.bora.pos.api.BoraApi
import br.com.sonare.bora.pos.api.CofreDeToken
import br.com.sonare.bora.pos.api.ContextoTerminal
import br.com.sonare.bora.pos.api.PedidoAutorizacao
import br.com.sonare.bora.pos.api.PedidoEncerramento
import br.com.sonare.bora.pos.api.PedidoHeartbeat
import br.com.sonare.bora.pos.api.PedidoPareamento
import br.com.sonare.bora.pos.api.SessaoTerminal
import br.com.sonare.bora.pos.pagamento.PagamentoPort
import br.com.sonare.bora.pos.pagamento.ResultadoPagamento
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
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
    data class Cobranca(val valorCents: Long) : Tela()
    object Registrando : Tela()
    data class Carregando(val sessao: SessaoTerminal, val encerrando: Boolean = false) : Tela()
    data class Encerrada(val sessao: SessaoTerminal) : Tela()
    data class Erro(val mensagem: String) : Tela()
  }

  private val _tela = MutableStateFlow<Tela>(Tela.Iniciando)
  val tela: StateFlow<Tela> = _tela

  private var contextoAtual: ContextoTerminal? = null
  private var trabalhoAtual: Job? = null

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

    trocarTrabalho {
      _tela.value = Tela.Cobranca(valor)
      when (val resultado = pagamento.preAutorizar(valor)) {
        is ResultadoPagamento.Aprovado -> registrarNoBackend(resultado, valor)
        is ResultadoPagamento.Recusado -> _tela.value = Tela.Erro(resultado.mensagem)
        is ResultadoPagamento.Falha -> _tela.value = Tela.Erro(resultado.mensagem)
      }
    }
  }

  /** O motorista desistiu na tela do cartão. */
  fun cancelarCobranca() {
    trocarTrabalho { carregarContexto() }
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
            acompanharSessao(corpo.sessionId)
          } else {
            // O backend recusou a sessão (conector ocupado, teto…). O dinheiro
            // está reservado à toa: devolve o limite ao motorista JÁ.
            pagamento.cancelarPreAutorizacao(aprovado.referencia)
            _tela.value = Tela.Erro(corpo.message ?: "A recarga não pôde começar. Nada foi cobrado.")
          }
          return
        }
        // 4xx: o backend explicou o motivo; retentar não muda nada.
        ultimaFalha = "O servidor recusou a autorização (${resposta.code()})."
        if (resposta.code() in 400..499) {
          pagamento.cancelarPreAutorizacao(aprovado.referencia)
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
        api.encerrar(atual.sessao.sessionId, PedidoEncerramento(reason = "motorista encerrou na maquininha"))
      } catch (e: IOException) {
        // O stop se perdeu na rede; o acompanhamento abaixo mostra o estado real.
      }
      acompanharSessao(atual.sessao.sessionId)
    }
  }

  fun novaRecarga() {
    trocarTrabalho { carregarContexto() }
  }

  /** Poll do estado a cada 5 s até a sessão deixar de estar ativa. */
  private suspend fun acompanharSessao(sessionId: String) {
    while (escopo.isActive) {
      try {
        val resposta = api.sessao(sessionId)
        val sessao = resposta.body()
        if (resposta.code() == 401) return aoTokenRevogado()
        if (resposta.isSuccessful && sessao != null) {
          if (!sessao.active) {
            _tela.value = Tela.Encerrada(sessao)
            return
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
        if (ativa != null) {
          // O app reabriu no meio de uma recarga: volta direto para a tela dela.
          acompanharSessao(ativa)
        } else {
          _tela.value = Tela.Pronta(contexto)
        }
      } else {
        _tela.value = Tela.Erro("O servidor respondeu ${resposta.code()}.")
      }
    } catch (e: IOException) {
      _tela.value = Tela.Erro("Sem conexão com o servidor. Verifique a internet do equipamento.")
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
}
