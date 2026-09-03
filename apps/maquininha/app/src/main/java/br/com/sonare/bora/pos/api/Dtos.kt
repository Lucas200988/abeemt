package br.com.sonare.bora.pos.api

/**
 * Espelho fiel do contrato HTTP da FASE 8 §3 (docs/payments/fase-8-maquininha.md)
 * e das interfaces reais do backend (terminal-session.service.ts).
 *
 * Regra de ouro: dinheiro em CENTAVOS INTEIROS, energia em Wh (ADR-0005).
 * Nenhum campo de cartão além dos quatro últimos dígitos (briefing seção 12) —
 * o backend recusa a requisição inteira se aparecer mais que isso.
 */

// --- POST /terminal/pair -----------------------------------------------------

data class PedidoPareamento(
  val pairingCode: String,
  val serialNumber: String? = null,
  val model: String? = null,
  val appVersion: String? = null,
)

data class RespostaPareamento(
  /** Devolvido UMA única vez. Guardado cifrado; perdido, gera-se outro código. */
  val token: String,
  val terminal: TerminalResumo?,
)

data class TerminalResumo(val id: String?, val name: String?)

// --- GET /terminal/me --------------------------------------------------------

data class ContextoTerminal(
  val terminal: TerminalResumo,
  val connector: ConectorContexto,
  val tariff: TarifaContexto,
  /** O valor a reservar vem DAQUI. O aplicativo nunca o decide (fase-8 §3.2). */
  val preAuthAmountCents: Long,
  val ceilingAmountCents: Long,
  val methods: List<String>,
  /** Sessão em andamento neste conector — o app retoma a tela CARREGANDO. */
  val activeSessionId: String?,
  /** Sessão encerrada com captura ainda pendente NESTE terminal — resolver antes de tudo. */
  val pendingCaptureSessionId: String? = null,
)

data class ConectorContexto(
  val id: String,
  val label: String,
  val status: String,
  val available: Boolean,
)

data class TarifaContexto(
  val name: String,
  val pricePerKwhCents: Long,
  val connectionFeeCents: Long,
  val pricePerMinuteCents: Long,
  val idleFeePerMinuteCents: Long,
)

// --- POST /terminal/authorization -------------------------------------------

/**
 * O que o corpo NÃO tem, de propósito: connectorId, provider, número de cartão.
 * O backend recusa com 400 se aparecerem (mitigação do risco R-32).
 */
data class PedidoAutorizacao(
  val providerPaymentId: String,
  val method: String,
  val amountAuthorizedCents: Long,
  /** Estável entre retentativas: reenviar devolve o MESMO pagamento. */
  val idempotencyKey: String,
  val cardBrand: String? = null,
  val cardLastFour: String? = null,
  val nsu: String? = null,
  val authorizationCode: String? = null,
)

data class RespostaAutorizacao(
  val sessionId: String?,
  val paymentId: String?,
  val status: String?,
  val approved: Boolean,
  /** Já vem em português, pronto para a tela. */
  val message: String?,
  val amountAuthorizedCents: Long?,
  val ceilingAmountCents: Long?,
)

// --- GET /terminal/sessions/:id ---------------------------------------------

data class SessaoTerminal(
  val sessionId: String,
  val status: String,
  val statusLabel: String?,
  val active: Boolean,
  val energyWh: Long,
  val durationSeconds: Long,
  val runningAmountCents: Long?,
  val finalAmountCents: Long?,
  val ceilingAmountCents: Long?,
  val amountAuthorizedCents: Long?,
  val amountCapturedCents: Long?,
  val message: String?,
  /** Presente só na resposta do stop. */
  val command: ComandoResultado? = null,
  /**
   * Captura aguardando execução POR ESTE terminal (provedores com a captura
   * no equipamento, como o PlugPag). amountCents > 0 = efetivar por esse valor
   * exato; amountCents == 0 = cancelar a reserva. Nulo = nada pendente.
   */
  val pendingCapture: PendenciaCaptura? = null,
)

data class PendenciaCaptura(val amountCents: Long)

// --- POST /terminal/sessions/:id/capture-result ------------------------------

data class PedidoResultadoCaptura(
  val success: Boolean,
  val amountCapturedCents: Long? = null,
  val nsu: String? = null,
  val authorizationCode: String? = null,
  val errorMessage: String? = null,
)

data class RespostaResultadoCaptura(
  val recorded: Boolean,
  val resultMessage: String?,
  val pendingCapture: PendenciaCaptura?,
)

data class ComandoResultado(val accepted: Boolean, val message: String?)

// --- POST /terminal/sessions/:id/stop ---------------------------------------

data class PedidoEncerramento(val reason: String? = null)

// --- POST /terminal/heartbeat ------------------------------------------------

data class PedidoHeartbeat(val appVersion: String? = null)
