package br.com.sonare.bora.pos.pagamento

import android.content.Context
import br.com.uol.pagseguro.plugpagservice.wrapper.PlugPag
import br.com.uol.pagseguro.plugpagservice.wrapper.PlugPagEffectuatePreAutoData
import br.com.uol.pagseguro.plugpagservice.wrapper.PlugPagPreAutoData
import br.com.uol.pagseguro.plugpagservice.wrapper.PlugPagPreAutoKeyingData
import br.com.uol.pagseguro.plugpagservice.wrapper.PlugPagTransactionResult
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
 *   preAutorizar          → PlugPag.doPreAutoCreate     (reserva o teto)
 *   efetivar              → PlugPag.doEffectuatePreAuto (captura PARCIAL — é o
 *                           que fez do PagBank o único adquirente completo da
 *                           matriz: cobra só o consumo real)
 *   cancelarPreAutorizacao→ PlugPag.doPreAutoCancel     (libera o limite)
 *
 * ⚠ PROCEDÊNCIA: A CONFIRMAR (mesma disciplina do CONTRATO do backend).
 * Os nomes de classes e métodos vêm da leitura do repositório oficial
 * pagseguro/pagseguro-sdk-plugpagservicewrapper (GitHub) — mas o briefing §18
 * manda não presumir que biblioteca funciona sem teste. As assinaturas exatas
 * (nomes de parâmetros, campos do resultado, códigos de erro) DEVEM ser
 * validadas contra o .aar real no terminal de desenvolvimento que o PagBank
 * enviar pela parceria. Compilou, rodou no equipamento, aí vira "confirmado".
 *
 * Regras que já valem, confirmadas ou não:
 *  - valores em CENTAVOS (mesma unidade do PlugPag e do backend — sem conversão);
 *  - do resultado do SDK, só saem daqui bandeira, 4 últimos dígitos, NSU e
 *    código de autorização. O que mais o PlugPag devolver, morre neste arquivo
 *    (briefing seção 12);
 *  - chamadas do PlugPag são bloqueantes → Dispatchers.IO.
 */
object FabricaPagamento {
  fun criar(contexto: Context): PagamentoPort = PagamentoPlugPag(PlugPag(contexto))
}

private class PagamentoPlugPag(private val plugPag: PlugPag) : PagamentoPort {
  override val nome = "pagbank-plugpag"

  override suspend fun preAutorizar(valorCents: Long): ResultadoPagamento =
    withContext(Dispatchers.IO) {
      try {
        // PROCEDÊNCIA a confirmar: builder/campos do PlugPagPreAutoData.
        val resultado = plugPag.doPreAutoCreate(
          PlugPagPreAutoKeyingData(amount = valorCents.toString()),
        )
        paraResultado(resultado)
      } catch (e: Exception) {
        ResultadoPagamento.Falha("Falha no PlugPag: ${e.message}")
      }
    }

  override suspend fun cancelarPreAutorizacao(
    referencia: ReferenciaPreAutorizacao,
  ): ResultadoPagamento = withContext(Dispatchers.IO) {
    try {
      // PROCEDÊNCIA a confirmar: o cancel recebe transactionCode/transactionId
      // da pré-autorização original.
      val resultado = plugPag.doPreAutoCancel(
        PlugPagPreAutoData(
          transactionCode = referencia.transactionCode.orEmpty(),
          transactionId = referencia.transactionId.orEmpty(),
        ),
      )
      paraResultado(resultado)
    } catch (e: Exception) {
      ResultadoPagamento.Falha("Falha ao cancelar a reserva: ${e.message}")
    }
  }

  override suspend fun efetivar(
    referencia: ReferenciaPreAutorizacao,
    valorCents: Long,
  ): ResultadoPagamento = withContext(Dispatchers.IO) {
    try {
      // PROCEDÊNCIA a confirmar: doEffectuatePreAuto aceita valor MENOR que o
      // reservado (captura parcial) — é a capacidade que sustenta o ADR-0008.
      // Validar no equipamento com reserva 500 / captura 100, como na
      // verificação de produção da API.
      val resultado = plugPag.doEffectuatePreAuto(
        PlugPagEffectuatePreAutoData(
          transactionCode = referencia.transactionCode.orEmpty(),
          transactionId = referencia.transactionId.orEmpty(),
          amount = valorCents.toString(),
        ),
      )
      paraResultado(resultado)
    } catch (e: Exception) {
      ResultadoPagamento.Falha("Falha ao efetivar a cobrança: ${e.message}")
    }
  }

  /**
   * Traduz o resultado do SDK para o vocabulário da porta.
   *
   * SÓ os campos que o backend aceita atravessam. `cardLastFour` é derivado
   * defensivamente: se o SDK devolver mais dígitos, cortamos para 4 aqui —
   * nunca confiar que o campo vem como o nome promete (briefing seção 12).
   */
  private fun paraResultado(r: PlugPagTransactionResult): ResultadoPagamento {
    // PROCEDÊNCIA a confirmar: PlugPag.RET_OK e os campos do resultado.
    if (r.result != PlugPag.RET_OK) {
      return ResultadoPagamento.Recusado(
        r.message ?: "Operação recusada (código ${r.errorCode ?: "?"}).",
      )
    }
    val ultimos4 = r.cardApplication // campo real a confirmar no .aar
      ?.filter { it.isDigit() }
      ?.takeLast(4)
      ?.takeIf { it.length == 4 }
    return ResultadoPagamento.Aprovado(
      referencia = ReferenciaPreAutorizacao(
        providerPaymentId = r.transactionId ?: r.transactionCode ?: "",
        transactionCode = r.transactionCode,
        transactionId = r.transactionId,
      ),
      metodo = "CREDIT_CARD", // pré-autorização só existe no crédito (CONTRATO PagBank)
      cardBrand = r.cardBrand,
      cardLastFour = ultimos4,
      nsu = r.hostNsu,
      authorizationCode = r.autoCode,
    )
  }
}
