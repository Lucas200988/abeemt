package br.com.sonare.bora.pos.pagamento

import android.content.Context
import br.com.sonare.bora.pos.BuildConfig
import br.com.uol.pagseguro.plugpagservice.wrapper.PlugPag
import br.com.uol.pagseguro.plugpagservice.wrapper.PlugPagActivationData
import br.com.uol.pagseguro.plugpagservice.wrapper.PlugPagEffectuatePreAutoData
import br.com.uol.pagseguro.plugpagservice.wrapper.PlugPagEventData
import br.com.uol.pagseguro.plugpagservice.wrapper.PlugPagEventListener
import br.com.uol.pagseguro.plugpagservice.wrapper.PlugPagPreAutoData
import br.com.uol.pagseguro.plugpagservice.wrapper.PlugPagTransactionResult
import br.com.uol.pagseguro.plugpagservice.wrapper.exception.PlugPagException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * FLAVOR PAGBANK — a mesma porta, implementada com o PlugPag.
 *
 * ESTE É O PONTO ONDE O PLUGPAG SE ENCAIXA. O resto do aplicativo não muda uma
 * linha entre o simulado e este arquivo.
 *
 * O mapeamento (ADR-0008 no vocabulário do SDK):
 *
 *   preAutorizar          → PlugPag.doPreAutoCreate       (reserva o teto)
 *   efetivar              → PlugPag.doEffectuatePreAuto   (captura PARCIAL — o
 *                           amount é próprio, separado do reservado)
 *   cancelarPreAutorizacao→ PlugPag.doPreAutoCancel       (libera o limite)
 *
 * PROCEDÊNCIA: assinaturas CONFIRMADAS NO BINÁRIO em 2026-08-05 — o .aar
 * oficial 1.35.0 foi baixado do repositório Maven público do PagBank, extraído
 * e inspecionado com javap, e as páginas Dokka geradas confirmam a ordem dos
 * parâmetros. O que resta "a confirmar" é só o COMPORTAMENTO no equipamento
 * (a captura parcial aceitar valor menor — teste: reservar 500, efetivar 100),
 * porque assinatura lida ≠ comportamento exercitado (briefing §18).
 *
 * Regras que já valem:
 *  - valores em CENTAVOS (a doc do SDK: "R$ 10,00 → 1000" — mesma convenção
 *    do ADR-0005; o amount do PlugPag é Int);
 *  - usamos SEMPRE PlugPagPreAutoData (cartão presente). A variante
 *    PlugPagPreAutoKeyingData recebe pan/cvv DIGITADOS — proibida para nós
 *    (briefing seção 12): número de cartão nunca passa pelo nosso código;
 *  - do resultado do SDK, só saem daqui bandeira, NSU e código de autorização.
 *    O bin (INÍCIO do cartão) e o holder ficam retidos neste arquivo;
 *  - chamadas do PlugPag são bloqueantes e lançam PlugPagException →
 *    Dispatchers.IO + try/catch aqui dentro.
 */
object FabricaPagamento {
  fun criar(contexto: Context): PagamentoPort = PagamentoPlugPag(PlugPag(contexto))
}

private class PagamentoPlugPag(private val plugPag: PlugPag) : PagamentoPort {
  override val nome = "pagbank-plugpag"

  /** Referência curta que sai no comprovante/relatórios do PagBank. */
  private val referenciaLoja = "BORACARREGAR"

  private var ativado = false

  /**
   * O PlugPag exige o pinpad inicializado e ativado antes de transacionar
   * (código PINPAD_NOT_INITIALIZED = -1036). A ativação usa o MESMO código de
   * ativação da conta PagBank digitado ao ativar o terminal; aqui ele vem do
   * gradle.properties local (bora.pagbank.codigoAtivacao), nunca do repositório.
   *
   * `isAuthenticated()` primeiro: se o terminal já está ativado (o caso normal
   * depois da primeira vez), não se reativa a cada boot.
   */
  private fun garantirAtivacao() {
    if (ativado) return
    if (plugPag.isAuthenticated()) {
      ativado = true
      return
    }
    val codigo = BuildConfig.PAGBANK_CODIGO_ATIVACAO
    if (codigo.isBlank()) {
      throw PlugPagException(
        "Terminal não ativado e sem código de ativação configurado " +
          "(bora.pagbank.codigoAtivacao no gradle.properties).",
      )
    }
    val resultado = plugPag.initializeAndActivatePinpad(PlugPagActivationData(codigo))
    if (resultado.result != PlugPag.RET_OK) {
      throw PlugPagException(
        resultado.errorMessage ?: "Falha na ativação do terminal (${resultado.errorCode}).",
      )
    }
    ativado = true
  }

  override suspend fun preAutorizar(
    valorCents: Long,
    aoMensagem: (String) -> Unit,
  ): ResultadoPagamento =
    withContext(Dispatchers.IO) {
      try {
        garantirAtivacao()
        // As instruções do serviço ("INSIRA O CARTÃO", "SENHA OK"…) chegam
        // por aqui enquanto o doPreAutoCreate bloqueia — mesmo padrão do app
        // demo oficial (SmartCoffee, PreAutoViewModel).
        plugPag.setEventListener(object : PlugPagEventListener {
          override fun onEvent(data: PlugPagEventData) {
            data.customMessage?.let(aoMensagem)
          }
        })
        val resultado = plugPag.doPreAutoCreate(
          PlugPagPreAutoData(
            amount = valorCents.toInt(),
            installmentType = PlugPag.INSTALLMENT_TYPE_A_VISTA,
            installments = 1,
            userReference = referenciaLoja,
            printReceipt = false,
          ),
        )
        paraResultado(resultado)
      } catch (e: PlugPagException) {
        ResultadoPagamento.Falha("Falha no PlugPag: ${e.message}")
      }
    }

  override suspend fun cancelarPreAutorizacao(
    referencia: ReferenciaPreAutorizacao,
  ): ResultadoPagamento = withContext(Dispatchers.IO) {
    try {
      garantirAtivacao()
      // Ordem confirmada na doc gerada: (transactionId, transactionCode).
      val resultado = plugPag.doPreAutoCancel(
        referencia.transactionId.orEmpty(),
        referencia.transactionCode.orEmpty(),
      )
      paraResultado(resultado)
    } catch (e: PlugPagException) {
      ResultadoPagamento.Falha("Falha ao cancelar a reserva: ${e.message}")
    }
  }

  override suspend fun efetivar(
    referencia: ReferenciaPreAutorizacao,
    valorCents: Long,
  ): ResultadoPagamento = withContext(Dispatchers.IO) {
    try {
      garantirAtivacao()
      // O amount é PRÓPRIO da efetivação — o formato da captura parcial que
      // sustenta o ADR-0008. Validar no equipamento: reservar 500, efetivar 100.
      val resultado = plugPag.doEffectuatePreAuto(
        PlugPagEffectuatePreAutoData(
          amount = valorCents.toInt(),
          userReference = referenciaLoja,
          printReceipt = false,
          transactionId = referencia.transactionId.orEmpty(),
          transactionCode = referencia.transactionCode.orEmpty(),
        ),
      )
      paraResultado(resultado)
    } catch (e: PlugPagException) {
      ResultadoPagamento.Falha("Falha ao efetivar a cobrança: ${e.message}")
    }
  }

  /**
   * Traduz o resultado do SDK para o vocabulário da porta.
   *
   * SÓ os campos que o backend aceita atravessam. `cardLastFour` fica nulo de
   * propósito: o PlugPagTransactionResult expõe `bin` (o INÍCIO do número) e
   * não os quatro últimos — enviar o bin no lugar seria mentira, e derivar
   * qualquer outra coisa seria chutar. O campo é opcional no contrato.
   */
  private fun paraResultado(r: PlugPagTransactionResult): ResultadoPagamento {
    if (r.result != PlugPag.RET_OK) {
      return ResultadoPagamento.Recusado(
        r.message ?: "Operação recusada (código ${r.errorCode ?: "?"}).",
      )
    }
    return ResultadoPagamento.Aprovado(
      referencia = ReferenciaPreAutorizacao(
        providerPaymentId = r.transactionId ?: r.transactionCode ?: "",
        transactionCode = r.transactionCode,
        transactionId = r.transactionId,
      ),
      metodo = "CREDIT_CARD", // pré-autorização só existe no crédito (CONTRATO PagBank)
      cardBrand = r.cardBrand,
      cardLastFour = null,
      nsu = r.hostNsu ?: r.nsu,
      authorizationCode = r.autoCode,
    )
  }
}
