package br.com.sonare.bora.pos.api

import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

/**
 * O contrato HTTP da maquininha, endpoint por endpoint (fase-8 §3).
 *
 * O Bearer token é injetado pelo interceptor do ClienteBackend — os métodos não
 * o recebem. `pair` é o único que dispensa token: é onde o token nasce.
 */
interface BoraApi {

  @POST("terminal/pair")
  suspend fun parear(@Body corpo: PedidoPareamento): Response<RespostaPareamento>

  @GET("terminal/me")
  suspend fun contexto(): Response<ContextoTerminal>

  @POST("terminal/authorization")
  suspend fun registrarAutorizacao(@Body corpo: PedidoAutorizacao): Response<RespostaAutorizacao>

  @GET("terminal/sessions/{id}")
  suspend fun sessao(@Path("id") id: String): Response<SessaoTerminal>

  @POST("terminal/sessions/{id}/stop")
  suspend fun encerrar(
    @Path("id") id: String,
    @Body corpo: PedidoEncerramento,
  ): Response<SessaoTerminal>

  @POST("terminal/sessions/{id}/capture-result")
  suspend fun resultadoCaptura(
    @Path("id") id: String,
    @Body corpo: PedidoResultadoCaptura,
  ): Response<RespostaResultadoCaptura>

  @POST("terminal/heartbeat")
  suspend fun heartbeat(@Body corpo: PedidoHeartbeat): Response<Unit>
}
