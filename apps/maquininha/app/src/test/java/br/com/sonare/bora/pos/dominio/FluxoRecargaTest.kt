@file:OptIn(ExperimentalCoroutinesApi::class)

package br.com.sonare.bora.pos.dominio

import br.com.sonare.bora.pos.api.BoraApi
import br.com.sonare.bora.pos.api.Cofre
import br.com.sonare.bora.pos.api.ComandoResultado
import br.com.sonare.bora.pos.api.ConectorContexto
import br.com.sonare.bora.pos.api.ContextoTerminal
import br.com.sonare.bora.pos.api.PedidoAutorizacao
import br.com.sonare.bora.pos.api.PedidoEncerramento
import br.com.sonare.bora.pos.api.PedidoHeartbeat
import br.com.sonare.bora.pos.api.PedidoPareamento
import br.com.sonare.bora.pos.api.PedidoResultadoCaptura
import br.com.sonare.bora.pos.api.PedidoResultadoDevolucao
import br.com.sonare.bora.pos.api.PendenciaCaptura
import br.com.sonare.bora.pos.api.PendenciaDevolucao
import br.com.sonare.bora.pos.api.RespostaAutorizacao
import br.com.sonare.bora.pos.api.RespostaPareamento
import br.com.sonare.bora.pos.api.RespostaResultadoCaptura
import br.com.sonare.bora.pos.api.RespostaResultadoDevolucao
import br.com.sonare.bora.pos.api.SessaoTerminal
import br.com.sonare.bora.pos.api.TarifaContexto
import br.com.sonare.bora.pos.api.TerminalResumo
import br.com.sonare.bora.pos.dominio.FluxoRecarga.Tela
import br.com.sonare.bora.pos.pagamento.PagamentoPort
import br.com.sonare.bora.pos.pagamento.ReferenciaPreAutorizacao
import br.com.sonare.bora.pos.pagamento.ResultadoPagamento
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancel
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.Response

/**
 * A máquina de estados da maquininha, em JVM pura.
 *
 * Sem Android, sem rede, sem SDK e sem esperar de verdade: a API e o
 * PagamentoPort são dublês, o cofre vive em memória e o tempo é virtual
 * (os 5 s do poll, os 90 s do estorno e os 3 min da conciliação avançam na
 * hora). Cada teste descreve uma regra que custou caro descobrir no terminal.
 */
class FluxoRecargaTest {

  // ---------------------------------------------------------------------------
  // Dublês
  // ---------------------------------------------------------------------------

  private class CofreEmMemoria : Cofre {
    private var token: String? = null
    private var chave: String? = null
    private val referencias = mutableMapOf<String, Triple<String, String?, String?>>()
    override fun token() = token
    override fun guardarToken(token: String) { this.token = token }
    override fun esquecerToken() { token = null }
    override fun chaveIdempotenciaPendente() = chave
    override fun guardarChaveIdempotencia(chave: String) { this.chave = chave }
    override fun limparChaveIdempotencia() { chave = null }
    override fun guardarReferenciaDaSessao(
      sessionId: String,
      providerPaymentId: String,
      transactionId: String?,
      transactionCode: String?,
    ) { referencias[sessionId] = Triple(providerPaymentId, transactionId, transactionCode) }
    override fun referenciaDaSessao(sessionId: String) = referencias[sessionId]
    override fun limparReferenciaDaSessao(sessionId: String) { referencias.remove(sessionId) }
  }

  private class PagamentoFake : PagamentoPort {
    val chamadas = mutableListOf<String>()
    var aoPreAutorizar: suspend (Long) -> ResultadoPagamento = { aprovado("PRE-$it") }
    var aoCobrar: suspend (String, Long) -> ResultadoPagamento = { m, v -> aprovado("VENDA-$v", m) }
    var aoEstornar: suspend (ReferenciaPreAutorizacao, String, Long) -> ResultadoPagamento =
      { r, m, _ -> ResultadoPagamento.Aprovado(r, m) }

    override val nome = "fake"
    override suspend fun preAutorizar(valorCents: Long, aoMensagem: (String) -> Unit): ResultadoPagamento {
      chamadas += "preAutorizar:$valorCents"
      aoMensagem("INSIRA O CARTÃO")
      return aoPreAutorizar(valorCents)
    }
    override suspend fun abortar() { chamadas += "abortar" }
    override suspend fun cobrarValorFixo(metodo: String, valorCents: Long, aoMensagem: (String) -> Unit): ResultadoPagamento {
      chamadas += "cobrar:$metodo:$valorCents"
      return aoCobrar(metodo, valorCents)
    }
    override suspend fun estornar(referencia: ReferenciaPreAutorizacao, metodo: String, valorCents: Long): ResultadoPagamento {
      chamadas += "estornar:$metodo:$valorCents"
      return aoEstornar(referencia, metodo, valorCents)
    }
    override suspend fun cancelarPreAutorizacao(referencia: ReferenciaPreAutorizacao): ResultadoPagamento {
      chamadas += "cancelar:${referencia.providerPaymentId}"
      return ResultadoPagamento.Aprovado(referencia, "CREDIT_CARD")
    }
    override suspend fun efetivar(referencia: ReferenciaPreAutorizacao, valorCents: Long): ResultadoPagamento {
      chamadas += "efetivar:$valorCents"
      return ResultadoPagamento.Aprovado(referencia, "CREDIT_CARD")
    }
  }

  private class ApiFake : BoraApi {
    var contexto: ContextoTerminal = contextoPadrao()
    var codigoContexto = 200
    val sessoes = mutableMapOf<String, SessaoTerminal>()
    var consultasDeSessao = 0
    val autorizacoes = mutableListOf<PedidoAutorizacao>()
    val capturas = mutableListOf<PedidoResultadoCaptura>()
    val devolucoes = mutableListOf<PedidoResultadoDevolucao>()
    val encerramentos = mutableListOf<String>()
    var encerrarAceito = true
    var respostaAutorizacao: (PedidoAutorizacao) -> Response<RespostaAutorizacao> = {
      Response.success(
        RespostaAutorizacao(
          sessionId = "S1", paymentId = "P1", status = "AUTHORIZED", approved = true,
          message = "ok", amountAuthorizedCents = it.amountAuthorizedCents,
          ceilingAmountCents = it.amountAuthorizedCents,
        ),
      )
    }

    override suspend fun parear(corpo: PedidoPareamento): Response<RespostaPareamento> =
      Response.success(RespostaPareamento("bora_pos_1", TerminalResumo("T1", "Maquininha")))
    override suspend fun contexto(): Response<ContextoTerminal> =
      if (codigoContexto == 200) Response.success(contexto) else erro(codigoContexto)
    override suspend fun registrarAutorizacao(corpo: PedidoAutorizacao): Response<RespostaAutorizacao> {
      autorizacoes += corpo
      return respostaAutorizacao(corpo)
    }
    override suspend fun sessao(id: String): Response<SessaoTerminal> {
      consultasDeSessao += 1
      return sessoes[id]?.let { Response.success(it) } ?: erro(404)
    }
    override suspend fun encerrar(id: String, corpo: PedidoEncerramento): Response<SessaoTerminal> {
      encerramentos += id
      val comando = if (encerrarAceito) ComandoResultado(true, "Encerrando") else ComandoResultado(false, "Carregador offline")
      return Response.success(sessoes.getValue(id).copy(command = comando))
    }
    override suspend fun resultadoCaptura(id: String, corpo: PedidoResultadoCaptura): Response<RespostaResultadoCaptura> {
      capturas += corpo
      return Response.success(RespostaResultadoCaptura(true, "ok", null))
    }
    override suspend fun resultadoDevolucao(id: String, corpo: PedidoResultadoDevolucao): Response<RespostaResultadoDevolucao> {
      devolucoes += corpo
      return Response.success(RespostaResultadoDevolucao(true, "ok", null))
    }
    override suspend fun heartbeat(corpo: PedidoHeartbeat): Response<Unit> = Response.success(Unit)

    private fun <T> erro(codigo: Int): Response<T> =
      Response.error(codigo, "{}".toResponseBody("application/json".toMediaType()))
  }

  /** Tudo o que um teste precisa, com o tempo virtual do TestScope. */
  private class Harness(escopoDeTeste: TestScope) {
    val cofre = CofreEmMemoria()
    val api = ApiFake()
    val pagamento = PagamentoFake()
    var agora = 0L
    val escopo = CoroutineScope(SupervisorJob() + StandardTestDispatcher(escopoDeTeste.testScheduler))
    val fluxo = FluxoRecarga(api, cofre, pagamento, escopo, "0.1.0-teste", relogio = { agora })
    val tela get() = fluxo.tela.value
    fun fechar() = escopo.cancel()
  }

  private fun teste(bloco: suspend TestScope.(Harness) -> Unit) = runTest {
    val h = Harness(this)
    try {
      bloco(h)
    } finally {
      h.fechar()
    }
  }

  private fun TestScope.avancar(ms: Long) {
    advanceTimeBy(ms)
    runCurrent()
  }

  // ---------------------------------------------------------------------------
  // Pareamento e contexto
  // ---------------------------------------------------------------------------

  @Test
  fun `sem token abre o pareamento, e parear guarda o token e mostra a tela pronta`() = teste { h ->
    h.fluxo.iniciar(); runCurrent()
    assertTrue(h.tela is Tela.Pareamento)

    h.fluxo.parear("k7m2qp4x"); runCurrent()
    assertEquals("bora_pos_1", h.cofre.token())
    assertTrue(h.tela is Tela.Pronta)
  }

  @Test
  fun `token revogado no painel volta ao pareamento e esquece o token`() = teste { h ->
    h.cofre.guardarToken("t")
    h.api.codigoContexto = 401

    h.fluxo.iniciar(); runCurrent()

    assertTrue(h.tela is Tela.Pareamento)
    assertNull(h.cofre.token())
  }

  @Test
  fun `a tela pronta se atualiza sozinha a cada 15 s`() = teste { h ->
    h.cofre.guardarToken("t")
    h.api.contexto = contextoPadrao().copy(connector = contextoPadrao().connector.copy(available = false))
    h.fluxo.iniciar(); runCurrent()
    assertFalse((h.tela as Tela.Pronta).contexto.connector.available)

    h.api.contexto = contextoPadrao()
    avancar(15_000)

    assertTrue((h.tela as Tela.Pronta).contexto.connector.available)
  }

  // ---------------------------------------------------------------------------
  // Crédito: reserva → registro → acompanhamento → captura pelo terminal
  // ---------------------------------------------------------------------------

  @Test
  fun `crédito reserva o valor do servidor, registra com idempotência e efetiva só quando a conciliação publica`() = teste { h ->
    h.cofre.guardarToken("t")
    h.fluxo.iniciar(); runCurrent()
    h.api.sessoes["S1"] = sessao("S1", active = true)

    h.fluxo.iniciarRecarga(); runCurrent()

    val autorizacao = h.api.autorizacoes.single()
    assertEquals(20_000L, autorizacao.amountAuthorizedCents) // o valor é o do /terminal/me
    assertEquals("CREDIT_CARD", autorizacao.method)
    assertTrue(autorizacao.idempotencyKey.length >= 8)
    assertNull(h.cofre.chaveIdempotenciaPendente()) // limpa após o sucesso
    assertNotNull(h.cofre.referenciaDaSessao("S1")) // guardada para efetivar depois
    assertTrue(h.tela is Tela.Carregando)

    // Sessão inativa ANTES de a conciliação decidir: espera, sem efetivar nada.
    h.api.sessoes["S1"] = sessao("S1", active = false, finalAmountCents = null)
    avancar(5000)
    assertTrue(h.tela is Tela.Encerrada)
    assertTrue(h.pagamento.chamadas.none { it.startsWith("efetivar") })
    assertNotNull(h.cofre.referenciaDaSessao("S1"))

    // A conciliação publica a pendência: efetiva o valor EXATO e confirma.
    h.api.sessoes["S1"] = sessao("S1", active = false, finalAmountCents = 800, pendingCapture = PendenciaCaptura(800))
    avancar(3000)
    assertTrue(h.pagamento.chamadas.contains("efetivar:800"))
    assertEquals(800L, h.api.capturas.single().amountCapturedCents)

    // Pendência resolvida: a referência pode ir embora.
    h.api.sessoes["S1"] = sessao("S1", active = false, finalAmountCents = 800)
    avancar(1500)
    assertNull(h.cofre.referenciaDaSessao("S1"))
  }

  @Test
  fun `sessão inativa que nunca é conciliada libera a tela depois de 3 min e mantém a referência`() = teste { h ->
    h.cofre.guardarToken("t")
    h.cofre.guardarReferenciaDaSessao("S1", "PRE-1", null, null)
    h.api.contexto = contextoPadrao().copy(activeSessionId = "S1")
    h.api.sessoes["S1"] = sessao("S1", active = false, finalAmountCents = null)

    h.fluxo.iniciar(); runCurrent()
    assertTrue(h.tela is Tela.Encerrada)

    h.agora = 4 * 60_000L
    avancar(3000)
    val consultas = h.api.consultasDeSessao
    avancar(30_000)

    assertEquals(consultas, h.api.consultasDeSessao) // o acompanhamento parou
    assertNotNull(h.cofre.referenciaDaSessao("S1")) // o /terminal/me devolve a pendência depois
  }

  // ---------------------------------------------------------------------------
  // Cancelamento e recusas
  // ---------------------------------------------------------------------------

  @Test
  fun `cancelar na tela do cartão aborta o SDK e desfaz uma aprovação que chegue junto`() = teste { h ->
    h.cofre.guardarToken("t")
    h.fluxo.iniciar(); runCurrent()
    val aprovacaoAtrasada = CompletableDeferred<ResultadoPagamento>()
    h.pagamento.aoPreAutorizar = { aprovacaoAtrasada.await() }

    h.fluxo.iniciarRecarga(); runCurrent()
    assertTrue(h.tela is Tela.Cobranca)

    h.fluxo.cancelarCobranca(); runCurrent()
    assertTrue(h.pagamento.chamadas.contains("abortar"))

    aprovacaoAtrasada.complete(aprovado("PRE-X")); runCurrent()

    assertTrue(h.pagamento.chamadas.contains("cancelar:PRE-X"))
    assertTrue(h.api.autorizacoes.isEmpty())
    assertTrue(h.tela is Tela.Pronta)
  }

  @Test
  fun `backend recusa a sessão de um pré-pago estorna a venda e mostra o motivo`() = teste { h ->
    h.cofre.guardarToken("t")
    h.fluxo.iniciar(); runCurrent()
    h.api.respostaAutorizacao = {
      Response.success(
        RespostaAutorizacao("S9", "P9", "DECLINED", approved = false, message = "Conector ocupado.", amountAuthorizedCents = 0, ceilingAmountCents = 0),
      )
    }

    h.fluxo.escolherPrePago("DEBIT_CARD"); runCurrent()
    assertEquals(listOf(2000L, 3000L, 5000L), (h.tela as Tela.EscolhaValor).opcoesCents)

    h.fluxo.pagarValorFixo(3000); runCurrent()

    assertTrue(h.pagamento.chamadas.contains("cobrar:DEBIT_CARD:3000"))
    assertEquals("DEBIT_CARD", h.api.autorizacoes.single().method)
    assertTrue(h.pagamento.chamadas.contains("estornar:DEBIT_CARD:3000"))
    assertEquals("Conector ocupado.", (h.tela as Tela.Erro).mensagem)
  }

  @Test
  fun `o app nunca inventa valor - fora das opções do servidor nada acontece`() = teste { h ->
    h.cofre.guardarToken("t")
    h.fluxo.iniciar(); runCurrent()

    h.fluxo.escolherPrePago("PIX"); runCurrent()
    h.fluxo.pagarValorFixo(999); runCurrent()

    assertTrue(h.tela is Tela.EscolhaValor)
    assertTrue(h.pagamento.chamadas.isEmpty())
  }

  @Test
  fun `encerramento recusado devolve o botão e mostra o motivo`() = teste { h ->
    h.cofre.guardarToken("t")
    h.api.contexto = contextoPadrao().copy(activeSessionId = "S1")
    h.api.sessoes["S1"] = sessao("S1", active = true)
    h.api.encerrarAceito = false
    h.fluxo.iniciar(); runCurrent()
    assertTrue(h.tela is Tela.Carregando)

    h.fluxo.encerrarRecarga(); runCurrent()

    val tela = h.tela as Tela.Carregando
    assertFalse(tela.encerrando)
    assertEquals("Carregador offline", tela.sessao.message)
  }

  // ---------------------------------------------------------------------------
  // Devolução de pré-pago pelo terminal
  // ---------------------------------------------------------------------------

  @Test
  fun `retomada após reinício executa a devolução pendente e confirma`() = teste { h ->
    h.cofre.guardarToken("t")
    h.cofre.guardarReferenciaDaSessao("S5", "VENDA-5", "TID", "TCODE")
    h.api.contexto = contextoPadrao().copy(pendingRefundSessionId = "S5")
    h.api.sessoes["S5"] = sessao("S5", active = false, finalAmountCents = 0, pendingRefund = PendenciaDevolucao(2000), paymentMethod = "PIX")

    h.fluxo.iniciar(); runCurrent()

    assertTrue(h.pagamento.chamadas.contains("estornar:PIX:2000"))
    val confirmacao = h.api.devolucoes.single()
    assertTrue(confirmacao.success)
    assertEquals(2000L, confirmacao.amountRefundedCents)
  }

  @Test
  fun `estorno que não responde é abortado aos 90 s e reportado como falha, sem travar`() = teste { h ->
    h.cofre.guardarToken("t")
    h.cofre.guardarReferenciaDaSessao("S5", "VENDA-5", "TID", "TCODE")
    h.api.contexto = contextoPadrao().copy(pendingRefundSessionId = "S5")
    h.api.sessoes["S5"] = sessao("S5", active = false, finalAmountCents = 0, pendingRefund = PendenciaDevolucao(2000), paymentMethod = "DEBIT_CARD")
    h.pagamento.aoEstornar = { _, _, _ -> awaitCancellation() }

    h.fluxo.iniciar(); runCurrent()
    assertTrue(h.api.devolucoes.isEmpty())

    avancar(90_000)

    assertTrue(h.pagamento.chamadas.contains("abortar"))
    assertFalse(h.api.devolucoes.first().success)
  }

  // ---------------------------------------------------------------------------
  // Construtores de dados
  // ---------------------------------------------------------------------------

  private companion object {
    fun contextoPadrao() = ContextoTerminal(
      terminal = TerminalResumo("T1", "Maquininha"),
      connector = ConectorContexto("C1", "Carregador 1 — conector 1", "AVAILABLE", true),
      tariff = TarifaContexto("Padrão", 220, 300, 0, 0),
      preAuthAmountCents = 20_000,
      ceilingAmountCents = 20_000,
      methods = listOf("CREDIT_CARD", "DEBIT_CARD", "PIX"),
      activeSessionId = null,
      pendingCaptureSessionId = null,
      pendingRefundSessionId = null,
      prepaidOptionsCents = listOf(2000, 3000, 5000),
    )

    fun sessao(
      id: String,
      active: Boolean,
      finalAmountCents: Long? = null,
      pendingCapture: PendenciaCaptura? = null,
      pendingRefund: PendenciaDevolucao? = null,
      paymentMethod: String = "CREDIT_CARD",
    ) = SessaoTerminal(
      sessionId = id,
      status = if (active) "CHARGING" else "COMPLETED",
      statusLabel = null,
      active = active,
      energyWh = 0,
      durationSeconds = 0,
      runningAmountCents = null,
      finalAmountCents = finalAmountCents,
      ceilingAmountCents = 20_000,
      amountAuthorizedCents = 20_000,
      amountCapturedCents = null,
      message = "msg",
      command = null,
      pendingCapture = pendingCapture,
      paymentMethod = paymentMethod,
      pendingRefund = pendingRefund,
    )

    fun aprovado(id: String, metodo: String = "CREDIT_CARD") = ResultadoPagamento.Aprovado(
      referencia = ReferenciaPreAutorizacao(id, transactionCode = "TC-$id", transactionId = "TI-$id"),
      metodo = metodo,
      cardBrand = "VISA",
      cardLastFour = "4321",
      nsu = "1",
      authorizationCode = "A1",
    )
  }
}
