package br.com.sonare.bora.pos.pagamento

/**
 * A porta de pagamento da maquininha — o espelho, no Android, do PaymentProvider
 * do backend.
 *
 * O aplicativo inteiro fala com ESTA interface e nunca com um SDK de adquirente.
 * Cada flavor do Gradle entrega uma implementação:
 *
 *   - flavor `simulado`: aprovação de mentira em 2 s. Casa com o provedor
 *     `terminal-mock` do backend — o fluxo completo roda em qualquer emulador.
 *   - flavor `pagbank`: PlugPag (doPreAutoCreate / doEffectuatePreAuto /
 *     doPreAutoCancel), só no equipamento do PagBank.
 *
 * Por que assim: o modelo comercial (ADR-0008) é reservar um teto e capturar só
 * o consumo. Qual SDK executa isso é detalhe do equipamento — e o dia em que a
 * Cielo ou a Getnet responderem sobre captura parcial, o custo de trocar é um
 * flavor novo, não um aplicativo novo.
 */
interface PagamentoPort {
  /** Nome curto para logs e diagnóstico ("simulado", "pagbank-plugpag"). */
  val nome: String

  /**
   * Reserva o valor no cartão do motorista (pré-autorização).
   *
   * O valor vem SEMPRE do `GET /terminal/me` (preAuthAmountCents) — o
   * aplicativo nunca decide quanto reservar (fase-8 §3.2). Em centavos
   * inteiros, nunca ponto flutuante (ADR-0005).
   *
   * `aoMensagem` recebe as instruções do SDK durante a leitura ("INSIRA O
   * CARTÃO", "SENHA OK"…) para a tela mostrar ao motorista — no PlugPag é o
   * `setEventListener`/`customMessage` (padrão do app demo oficial
   * SmartCoffee). Pode ser chamado de qualquer thread.
   */
  suspend fun preAutorizar(valorCents: Long, aoMensagem: (String) -> Unit = {}): ResultadoPagamento

  /**
   * Desfaz uma reserva que não vai virar recarga (backend recusou a sessão,
   * motorista desistiu). Nada foi cobrado; isto libera o limite do cartão.
   */
  suspend fun cancelarPreAutorizacao(referencia: ReferenciaPreAutorizacao): ResultadoPagamento

  /**
   * Captura PARCIAL da reserva — cobra só o consumo real.
   *
   * Hoje quem dispara a captura é a conciliação do backend (fase-8 §3.4), mas
   * no PlugPag a pré-autorização vive DENTRO do equipamento, então a efetivação
   * também é executada aqui. A orquestração (backend manda "capture X centavos"
   * e o terminal executa) é trabalho da integração final — o método já existe
   * para o contrato ficar completo desde o primeiro dia.
   */
  suspend fun efetivar(referencia: ReferenciaPreAutorizacao, valorCents: Long): ResultadoPagamento
}

/**
 * O que identifica uma pré-autorização para o SDK que a criou.
 *
 * `providerPaymentId` é o que vai no `POST /terminal/authorization`; os demais
 * campos são o que alguns SDKs exigem de volta para cancelar/efetivar.
 */
data class ReferenciaPreAutorizacao(
  val providerPaymentId: String,
  val transactionCode: String? = null,
  val transactionId: String? = null,
)

/**
 * Resultado de qualquer operação da porta.
 *
 * Só circulam aqui os dados que o backend aceita (fase-8 §3.3): bandeira,
 * QUATRO últimos dígitos, NSU e código de autorização. Número completo, CVV e
 * trilha não têm campo — se um SDK os devolver, morrem na implementação do
 * flavor (briefing seção 12).
 */
sealed class ResultadoPagamento {
  data class Aprovado(
    val referencia: ReferenciaPreAutorizacao,
    /** CREDIT_CARD ou DEBIT_CARD — o vocabulário do backend. */
    val metodo: String,
    val cardBrand: String? = null,
    /** Exatamente 4 dígitos, nunca mais que isso. */
    val cardLastFour: String? = null,
    val nsu: String? = null,
    val authorizationCode: String? = null,
  ) : ResultadoPagamento()

  /** O emissor disse não. Nada foi cobrado; o motorista pode tentar outro cartão. */
  data class Recusado(val mensagem: String) : ResultadoPagamento()

  /** Falha operacional (SDK, comunicação). Diferente de recusa: pode retentar. */
  data class Falha(val mensagem: String) : ResultadoPagamento()
}
