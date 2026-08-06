package br.com.sonare.bora.pos.api

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Onde o token `bora_pos_…` mora no equipamento.
 *
 * EncryptedSharedPreferences, não SharedPreferences puro: a maquininha fica
 * presa a um poste na rua, e o token é a credencial que liga o carregador
 * (risco R-32). Cifrado em repouso com chave do Android Keystore, um dump do
 * armazenamento não entrega a credencial.
 *
 * O token é devolvido pelo backend UMA única vez, no pareamento. Perdido, não
 * há recuperação — gera-se outro código no painel e pareia-se de novo.
 */
class CofreDeToken(contexto: Context) {

  private val prefs: SharedPreferences by lazy {
    val chave = MasterKey.Builder(contexto)
      .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
      .build()
    EncryptedSharedPreferences.create(
      contexto,
      "bora_pos_cofre",
      chave,
      EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
      EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )
  }

  fun token(): String? = prefs.getString(CHAVE_TOKEN, null)

  fun guardarToken(token: String) {
    prefs.edit().putString(CHAVE_TOKEN, token).apply()
  }

  /** Backend respondeu 401: o token foi revogado no painel. Volta ao pareamento. */
  fun esquecerToken() {
    prefs.edit().remove(CHAVE_TOKEN).apply()
  }

  /**
   * Chave de idempotência da autorização EM ANDAMENTO.
   *
   * Persistida — não fica só em memória — porque o cenário que ela protege é
   * exatamente o app morrer entre o cartão aprovado e a resposta do backend.
   * Ao religar, reenvia com a MESMA chave e recebe o MESMO pagamento, em vez
   * de criar uma segunda cobrança (fase-8 §3.3).
   */
  fun chaveIdempotenciaPendente(): String? = prefs.getString(CHAVE_IDEMPOTENCIA, null)

  fun guardarChaveIdempotencia(chave: String) {
    prefs.edit().putString(CHAVE_IDEMPOTENCIA, chave).apply()
  }

  fun limparChaveIdempotencia() {
    prefs.edit().remove(CHAVE_IDEMPOTENCIA).apply()
  }

  /**
   * Referência da pré-autorização de uma sessão (transactionId/transactionCode
   * do SDK), persistida para o caso `captureLocation: 'terminal'`: a captura
   * pode ser pedida pelo backend MINUTOS depois — inclusive após o app
   * reiniciar — e sem a referência o SDK não sabe qual reserva efetivar.
   *
   * Formato: "providerPaymentId|transactionId|transactionCode" (nenhum dos
   * três contém '|': são identificadores alfanuméricos do adquirente).
   */
  fun guardarReferenciaDaSessao(
    sessionId: String,
    providerPaymentId: String,
    transactionId: String?,
    transactionCode: String?,
  ) {
    prefs.edit()
      .putString(
        PREFIXO_REFERENCIA + sessionId,
        listOf(providerPaymentId, transactionId.orEmpty(), transactionCode.orEmpty())
          .joinToString("|"),
      )
      .apply()
  }

  fun referenciaDaSessao(sessionId: String): Triple<String, String?, String?>? {
    val bruto = prefs.getString(PREFIXO_REFERENCIA + sessionId, null) ?: return null
    val partes = bruto.split("|")
    if (partes.isEmpty() || partes[0].isBlank()) return null
    return Triple(
      partes[0],
      partes.getOrNull(1)?.takeIf { it.isNotBlank() },
      partes.getOrNull(2)?.takeIf { it.isNotBlank() },
    )
  }

  fun limparReferenciaDaSessao(sessionId: String) {
    prefs.edit().remove(PREFIXO_REFERENCIA + sessionId).apply()
  }

  private companion object {
    const val CHAVE_TOKEN = "token"
    const val CHAVE_IDEMPOTENCIA = "idempotency_key_pendente"
    const val PREFIXO_REFERENCIA = "preauto_"
  }
}
