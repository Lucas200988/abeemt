package br.com.sonare.bora.pos

import android.app.Application
import br.com.sonare.bora.pos.api.ClienteBackend
import br.com.sonare.bora.pos.api.CofreDeToken
import br.com.sonare.bora.pos.pagamento.FabricaPagamento
import br.com.sonare.bora.pos.pagamento.PagamentoPort

/**
 * Composição do aplicativo, à mão.
 *
 * Três singletons e nenhum framework de injeção: para um app de uma tela,
 * Dagger/Hilt seria abstração sem necessidade (briefing §18).
 *
 * `FabricaPagamento` NÃO existe neste source set: cada flavor traz a sua
 * (simulado/ ou pagbank/). É o compilador quem escolhe o adquirente.
 */
class App : Application() {

  lateinit var cofre: CofreDeToken
    private set
  lateinit var backend: ClienteBackend
    private set
  lateinit var pagamento: PagamentoPort
    private set

  override fun onCreate() {
    super.onCreate()
    cofre = CofreDeToken(this)
    backend = ClienteBackend(cofre)
    pagamento = FabricaPagamento.criar(this)
  }
}
