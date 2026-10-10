package br.com.sonare.bora.pos.api

import br.com.sonare.bora.pos.BuildConfig
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

/**
 * Monta o Retrofit que fala com a API do Borá Carregar.
 *
 * O interceptor injeta `Authorization: Bearer bora_pos_…` em toda chamada que
 * tiver token no cofre — inclusive nenhum cabeçalho quando não há token, que é
 * o estado do pareamento.
 */
class ClienteBackend(private val cofre: CofreDeToken) {

  val api: BoraApi by lazy {
    val logging = HttpLoggingInterceptor().apply {
      // BASIC, nunca BODY: o BODY logaria o token do pareamento e dados de
      // pagamento no logcat — que em SmartPOS é lido por qualquer USB.
      level = if (BuildConfig.DEBUG) HttpLoggingInterceptor.Level.BASIC
      else HttpLoggingInterceptor.Level.NONE
    }

    val http = OkHttpClient.Builder()
      .connectTimeout(10, TimeUnit.SECONDS)
      .readTimeout(20, TimeUnit.SECONDS)
      .addInterceptor { corrente ->
        val token = cofre.token()
        val requisicao = if (token == null) {
          corrente.request()
        } else {
          corrente.request().newBuilder()
            .header("Authorization", "Bearer $token")
            .build()
        }
        corrente.proceed(requisicao)
      }
      .addInterceptor(logging)
      .build()

    Retrofit.Builder()
      .baseUrl(BuildConfig.BORA_BASE_URL.trimEnd('/') + "/")
      .client(http)
      .addConverterFactory(GsonConverterFactory.create())
      .build()
      .create(BoraApi::class.java)
  }
}
