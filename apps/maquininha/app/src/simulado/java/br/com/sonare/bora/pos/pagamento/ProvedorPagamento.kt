package br.com.sonare.bora.pos.pagamento

import android.content.Context
import kotlinx.coroutines.delay
import java.util.UUID

/**
 * FLAVOR SIMULADO — pagamento de mentira, para desenvolver sem maquininha.
 *
 * Casa com o provedor `terminal-mock` do backend: este lado finge que o cartão
 * aprovou, aquele lado registra a "autorização" e liga o carregador (simulado
 * pelo ocpp-simulator). O fluxo inteiro — pareamento, cartão, recarga,
 * encerramento — roda hoje em qualquer emulador Android.
 *
 * NENHUM dinheiro se move, e o backend recusa subir em produção com o
 * terminal-mock configurado (mesma regra do provedor `mock`).
 */
object FabricaPagamento {
  fun criar(@Suppress("UNUSED_PARAMETER") contexto: Context): PagamentoPort = PagamentoSimulado()
}

private class PagamentoSimulado : PagamentoPort {
  override val nome = "simulado"

  override suspend fun preAutorizar(
    valorCents: Long,
    aoMensagem: (String) -> Unit,
  ): ResultadoPagamento {
    // Os 2 segundos existem para a tela "aproxime o cartão" ser vista e o
    // fluxo de espera ser exercitado — igualzinho ao equipamento real,
    // incluindo as mensagens de progresso que o PlugPag manda pela mesma via.
    aoMensagem("APROXIME OU INSIRA O CARTÃO")
    delay(1200)
    aoMensagem("PROCESSANDO…")
    delay(800)
    return ResultadoPagamento.Aprovado(
      referencia = ReferenciaPreAutorizacao(providerPaymentId = "SIM-${UUID.randomUUID()}"),
      metodo = "CREDIT_CARD",
      cardBrand = "SIMULADO",
      cardLastFour = "0000",
      nsu = "000000",
      authorizationCode = "SIM000",
    )
  }

  override suspend fun cancelarPreAutorizacao(referencia: ReferenciaPreAutorizacao): ResultadoPagamento {
    delay(500)
    return ResultadoPagamento.Aprovado(referencia, metodo = "CREDIT_CARD")
  }

  override suspend fun efetivar(
    referencia: ReferenciaPreAutorizacao,
    valorCents: Long,
  ): ResultadoPagamento {
    delay(500)
    return ResultadoPagamento.Aprovado(referencia, metodo = "CREDIT_CARD")
  }
}
