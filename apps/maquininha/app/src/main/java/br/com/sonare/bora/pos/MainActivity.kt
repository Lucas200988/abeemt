package br.com.sonare.bora.pos

import android.os.Build
import android.os.Bundle
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import br.com.sonare.bora.pos.api.SessaoTerminal
import br.com.sonare.bora.pos.databinding.ActivityMainBinding
import br.com.sonare.bora.pos.dominio.FluxoRecarga
import br.com.sonare.bora.pos.dominio.FluxoRecarga.Tela
import kotlinx.coroutines.launch
import java.util.Locale

/**
 * A única Activity. Observa a FluxoRecarga e mostra o contêiner do estado
 * corrente — toda a lógica mora na máquina de estados, aqui só se desenha.
 */
class MainActivity : AppCompatActivity() {

  private lateinit var binding: ActivityMainBinding
  private lateinit var fluxo: FluxoRecarga

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    binding = ActivityMainBinding.inflate(layoutInflater)
    setContentView(binding.root)

    val app = application as App
    fluxo = FluxoRecarga(
      api = app.backend.api,
      cofre = app.cofre,
      pagamento = app.pagamento,
      escopo = lifecycleScope,
      versaoApp = BuildConfig.VERSION_NAME,
      modeloEquipamento = Build.MODEL,
      serieEquipamento = null, // Build.SERIAL exige permissão especial em Android novo
    )

    ligarBotoes()
    observarFluxo()
    fluxo.iniciar()
  }

  private fun ligarBotoes() = with(binding) {
    botaoParear.setOnClickListener { fluxo.parear(campoCodigoPareamento.text.toString()) }
    botaoIniciar.setOnClickListener { fluxo.iniciarRecarga() }
    botaoCancelarCobranca.setOnClickListener { fluxo.cancelarCobranca() }
    botaoEncerrar.setOnClickListener { fluxo.encerrarRecarga() }
    botaoNovaRecarga.setOnClickListener { fluxo.novaRecarga() }
    botaoTentarDeNovo.setOnClickListener { fluxo.tentarDeNovo() }
  }

  private fun observarFluxo() {
    lifecycleScope.launch {
      repeatOnLifecycle(Lifecycle.State.STARTED) {
        fluxo.tela.collect { desenhar(it) }
      }
    }
  }

  private fun desenhar(tela: Tela) = with(binding) {
    val todas = listOf(
      telaPareamento, telaPronta, telaCobranca,
      telaRegistrando, telaCarregando, telaEncerrada, telaErro,
    )
    todas.forEach { it.visibility = View.GONE }

    when (tela) {
      is Tela.Iniciando -> Unit // fundo vazio por instantes; sem tela própria

      is Tela.Pareamento -> {
        telaPareamento.visibility = View.VISIBLE
        botaoParear.isEnabled = !tela.emAndamento
        botaoParear.setText(
          if (tela.emAndamento) R.string.pareamento_em_andamento else R.string.pareamento_botao,
        )
        campoCodigoPareamento.error = tela.erro
      }

      is Tela.Pronta -> {
        telaPronta.visibility = View.VISIBLE
        val c = tela.contexto
        textoPrecoKwh.text = getString(R.string.pronta_preco_kwh, reais(c.tariff.pricePerKwhCents))
        textoTaxaConexao.visibility = if (c.tariff.connectionFeeCents > 0) View.VISIBLE else View.GONE
        textoTaxaConexao.text = getString(R.string.pronta_taxa_conexao, reais(c.tariff.connectionFeeCents))
        textoReserva.text = getString(R.string.pronta_reserva, reais(c.preAuthAmountCents))
        textoIndisponivel.visibility = if (c.connector.available) View.GONE else View.VISIBLE
        botaoIniciar.isEnabled = c.connector.available
      }

      is Tela.Cobranca -> {
        telaCobranca.visibility = View.VISIBLE
        textoCobrancaValor.text = getString(R.string.cobranca_subtitulo, reais(tela.valorCents))
      }

      is Tela.Registrando -> telaRegistrando.visibility = View.VISIBLE

      is Tela.Carregando -> {
        telaCarregando.visibility = View.VISIBLE
        desenharSessao(tela.sessao)
        botaoEncerrar.isEnabled = !tela.encerrando
        botaoEncerrar.setText(
          if (tela.encerrando) R.string.carregando_encerrando else R.string.carregando_botao_encerrar,
        )
      }

      is Tela.Encerrada -> {
        telaEncerrada.visibility = View.VISIBLE
        textoResumoEnergia.text = getString(R.string.encerrada_resumo_energia, kwh(tela.sessao.energyWh))
        val valor = tela.sessao.finalAmountCents ?: tela.sessao.runningAmountCents
        textoResumoValor.text = getString(R.string.encerrada_resumo_valor, reais(valor ?: 0))
      }

      is Tela.Erro -> {
        telaErro.visibility = View.VISIBLE
        textoErro.text = tela.mensagem
      }
    }
  }

  private fun desenharSessao(sessao: SessaoTerminal) = with(binding) {
    textoEnergia.text = getString(R.string.carregando_energia, kwh(sessao.energyWh))
    val valor = sessao.runningAmountCents ?: sessao.finalAmountCents
    textoValorCorrente.text = getString(R.string.carregando_valor, reais(valor ?: 0))
    textoDuracao.text = getString(R.string.carregando_duracao, duracao(sessao.durationSeconds))
    textoMensagemSessao.text = sessao.message ?: ""
  }

  // Formatação da tela: centavos → "12,34"; Wh → "1,50"; segundos → "1h 02min".
  private fun reais(cents: Long): String =
    String.format(Locale("pt", "BR"), "%,.2f", cents / 100.0)

  private fun kwh(wh: Long): String =
    String.format(Locale("pt", "BR"), "%,.2f", wh / 1000.0)

  private fun duracao(segundos: Long): String {
    val h = segundos / 3600
    val m = (segundos % 3600) / 60
    return if (h > 0) String.format(Locale.ROOT, "%dh %02dmin", h, m)
    else String.format(Locale.ROOT, "%dmin", m)
  }
}
