package br.com.sonare.bora.pos.api

/**
 * O que o fluxo da recarga precisa guardar no equipamento.
 *
 * Interface para o domínio (FluxoRecarga) não depender de Android: a
 * implementação real é o CofreDeToken (EncryptedSharedPreferences); os testes
 * em JVM usam um cofre em memória.
 */
interface Cofre {
  fun token(): String?
  fun guardarToken(token: String)
  fun esquecerToken()

  fun chaveIdempotenciaPendente(): String?
  fun guardarChaveIdempotencia(chave: String)
  fun limparChaveIdempotencia()

  fun guardarReferenciaDaSessao(
    sessionId: String,
    providerPaymentId: String,
    transactionId: String?,
    transactionCode: String?,
  )

  fun referenciaDaSessao(sessionId: String): Triple<String, String?, String?>?
  fun limparReferenciaDaSessao(sessionId: String)
}
