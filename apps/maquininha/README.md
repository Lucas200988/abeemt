# Borá Carregar — aplicativo da maquininha (FASE 8)

O aplicativo Android que roda **no terminal de pagamento** preso ao carregador.
O motorista conecta o cabo, aproxima o cartão e carrega — sem aplicativo no
celular, sem cadastro.

```
conecte o cabo  →  aproxime o cartão  →  carregando (kWh/valor ao vivo)  →  encerrada
   (PRONTA)          (COBRANÇA)             (CARREGANDO)                   (resumo)
```

## Como abrir

Este diretório **não faz parte do build pnpm/turbo** (não tem package.json, de
propósito). Abra no **Android Studio**: `File > Open >` esta pasta
(`apps/maquininha`).

## Os dois flavors — e o ponto onde o PlugPag se encaixa

A camada de pagamento é uma **porta** (`PagamentoPort`), com uma implementação
por flavor do Gradle — a mesma disciplina do `PaymentProvider` no backend:

| Flavor     | O que faz                                                               | Onde roda                           |
| ---------- | ----------------------------------------------------------------------- | ----------------------------------- |
| `simulado` | Aprova em 2 s, sem SDK nenhum. Casa com o `terminal-mock` do backend.   | Qualquer emulador/celular, **hoje** |
| `pagbank`  | PlugPag: `doPreAutoCreate` / `doEffectuatePreAuto` / `doPreAutoCancel`. | Só no equipamento PagBank           |

O resto do aplicativo não sabe qual flavor está ativo. Trocar de adquirente
amanhã (Cielo, Getnet…) é escrever outro flavor — não outro aplicativo.

O arquivo do encaixe: `app/src/pagbank/java/.../pagamento/ProvedorPagamento.kt`.

## Rodar hoje, com o backend local

1. Suba a API e o simulador de carregador (na raiz do monorepo):
   `pnpm dev` — a API fica em `http://localhost:3001`.
2. No painel, crie um terminal para um conector e gere o **código de
   pareamento** (validade de 15 min).
3. No Android Studio, selecione a variante **simuladoDebug** e rode no
   emulador. O app acessa a API do host via `10.0.2.2` (já configurado).
4. Digite o código de pareamento. Pronto: o fluxo inteiro — cartão simulado,
   recarga simulada — roda de ponta a ponta.

Celular físico em vez de emulador: `bora.baseUrl` no `~/.gradle/gradle.properties`
(ver o roteiro abaixo) — o `10.0.2.2` só existe dentro do emulador.

## Dia 1 com o terminal de desenvolvimento (Moderninha Smart 2 DEBUG)

O terminal DEBUG chega **ativado** e opera em ambiente de QA: as transações são
simuladas e **não movem dinheiro de ninguém**. Teste à vontade.

**Preparação (uma vez)**

1. No terminal: atualize os aplicativos de serviço pela **Loja de Aplicativos**
   antes de qualquer teste (recomendação do PagBank).
2. No computador: instale o **Android Studio** (traz o JDK 17 e o `adb`).
3. **Caminho recomendado — túnel pelo cabo USB.** Com o terminal no USB, rode
   (a porta é a `API_PORT` do `.env`; aqui, 3006):
   ```
   "%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" reverse tcp:3006 tcp:3006
   ```
   O terminal passa a alcançar a API do PC em `127.0.0.1`, sem depender de
   Wi-Fi, IP ou Firewall do Windows. Refaça o comando sempre que o cabo for
   reconectado ou o terminal reiniciar. As transações de cartão **não** usam o
   túnel — o PlugPag fala com o PagBank pela internet do próprio terminal.
4. Crie/edite `C:\Users\<você>\.gradle\gradle.properties` — fora do repositório.
   O valor é gravado no APK na compilação: mudou, clique em ▶ Run de novo.
   ```
   bora.baseUrl=http://127.0.0.1:3006/api/v1
   ```
   Sem cabo (como no piloto), use o IP do PC na mesma rede Wi-Fi
   (`http://192.168.x.x:3006/api/v1`). Foi o que deu _timeout_ no primeiro dia
   (2026-10-09): o Firewall do Windows barra conexões vindas de outro aparelho
   mesmo quando o navegador do próprio PC abre a API. Exige rede com perfil
   **Privada** e a porta liberada no firewall.
   (`bora.pagbank.codigoAtivacao` não é necessário: o terminal DEBUG já vem
   ativado — o app só usa o código se `isAuthenticated()` disser que não.)
5. No `.env` do backend: `BORA_TERMINAL_PAYMENT_PROVIDER=terminal-mock` e
   **`BORA_TERMINAL_MOCK_CAPTURE_LOCATION=terminal`** — o backend só registra; quem
   reserva, efetiva e cancela é o PlugPag de verdade, dentro do terminal.
6. `pnpm dev` na raiz do monorepo (com o Docker Desktop aberto: o PostgreSQL roda nele). Na primeira vez, aceite o aviso do Firewall do
   Windows para o Node (rede **privada**) — sem isso o terminal não alcança a API.

**Instalar e rodar**

7. Ligue o terminal ao computador pelo cabo USB e confira: `adb devices` deve
   listar o equipamento. Se não listar, abra chamado no portal PagBank com o
   **número de série (SN)** — é o canal indicado por eles para o terminal DEBUG.
8. Android Studio → `File > Open > apps/maquininha` → aguarde o Gradle sincronizar
   → em _Build Variants_ escolha **`pagbankDebug`** → ▶ Run com o terminal
   selecionado.
9. No painel: crie a maquininha para um conector, gere o código de pareamento e
   digite no terminal.

**A bateria de testes (nesta ordem)**

| #   | Teste                                                     | O que prova                                                                  |
| --- | --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1   | Pareamento + tela "Conecte o cabo" com tarifa e reserva   | Rede terminal → API, token cifrado, `/terminal/me`                           |
| 2   | Iniciar → cartão de teste → aprovar                       | `doPreAutoCreate` real, mensagens do SDK ao vivo na tela                     |
| 3   | Recarga no simulador OCPP → encerrar                      | Fluxo completo até a conciliação publicar `pendingCapture`                   |
| 4   | **Captura parcial: reservar o teto, efetivar o consumo**  | **O teste decisivo** — `doEffectuatePreAuto` com valor MENOR que o reservado |
| 5   | Recarga sem consumo (encerrar antes de carregar)          | `doPreAutoCancel` — pendência de valor zero                                  |
| 6   | Desligar o terminal entre o fim da recarga e a efetivação | Retomada pelo `pendingCaptureSessionId` ao religar                           |
| 7   | Cartão recusado / cancelar na tela do cartão              | Caminhos de erro sem pendência pendurada                                     |

Para o teste 4 ficar didático, use uma tarifa e um teto baixos no painel (ex.:
teto R$ 10,00 em Carregadores → editar → "Teto por sessão"): o consumo
simulado fica bem abaixo e a diferença é visível — e o emissor do cartão não
recusa a reserva por limite depois de várias repetições.

**Débito e Pix (pré-pagos, ADR-0010 §6)** — na tela PRONTA aparecem os botões
"Débito" e "Pix"; o motorista escolhe um valor entre os que o servidor publica
(`BORA_PREPAID_OPTIONS_CENTS`, filtrados pelo mínimo da tarifa e pelo teto):

| #   | Teste                                                  | O que prova                                                       |
| --- | ------------------------------------------------------ | ----------------------------------------------------------------- |
| 8   | Débito: escolher valor → cartão → carregar → encerrar  | `doPayment(TYPE_DEBITO)`, pagamento CAPTURED na hora, teto = pago |
| 9   | Pix: escolher valor → QR na tela → pagar pelo banco    | `doPayment(TYPE_PIX)` — o serviço mostra o QR e confirma          |
| 10  | Débito ou Pix sem consumo (encerrar antes de carregar) | `voidPayment` pela pendência `pendingRefund` → REFUNDED           |

Ressalva aberta no teste 10: o estorno de cartão pode pedir o cartão de novo
no equipamento. O app espera até 90 s, aborta e reporta a falha — a pendência
fica no painel para o operador devolver pela retaguarda.

**O que registrar de cada teste** (vira o anexo da homologação do APK, como os
logs da API viraram em agosto): o `result`, `errorCode` e `message` devolvidos
pelo SDK, o `transactionId`/`transactionCode`, e o valor efetivado. **Nunca**
fotografe o comprovante ou a tela com dados de cartão — use só os cartões de
teste do ambiente DEBUG.

## Flavor `pagbank` — o que já está confirmado e o que falta

O wrapper do PlugPag é um repositório Maven **público** (sem credencial) no
GitHub do PagBank — já configurado no `settings.gradle.kts`. Em 2026-08-05 o
`.aar` oficial **1.35.0** foi baixado, extraído e inspecionado com `javap`:
as assinaturas usadas no flavor estão **confirmadas no binário** —
`doPreAutoCreate(PlugPagPreAutoData)`, `doEffectuatePreAuto` com `amount`
próprio (o formato da captura parcial), `doPreAutoCancel(transactionId,
transactionCode)` e a ativação `initializeAndActivatePinpad`.

Configuração local (nunca versionada) em `~/.gradle/gradle.properties`:

```
bora.pagbank.codigoAtivacao=CODIGO_DE_ATIVACAO_DA_SUA_CONTA
```

O que ainda depende do PagBank:

- [x] Parceria aprovada (riscos aprovados 2026-08-26; homologação da API
      FINALIZADA — chamado 1424039934)
- [x] Terminal de desenvolvimento **recebido em 2026-10-09** (Moderninha
      Smart 2 DEBUG) — roteiro do primeiro dia acima
- [x] **Captura parcial validada no equipamento (2026-10-10)**: reserva de
      R$ 200,00, efetivação de R$ 5,00 pelo `doEffectuatePreAuto` na Gertec
      GPOS780S DEBUG — ver fase-8 §8.1-K. Testes 5 e 7 ✅; falta o 6
- [ ] **Débito e Pix no equipamento** (testes 8–10): código pronto e compilado
      contra o SDK; comportamento do `doPayment`/`voidPayment` a confirmar
- [ ] Homologação do APK no Guia de Boas Práticas (targetSdk 23 no flavor
      pagbank ✓, sem cleartext em release ✓, permissões mínimas ✓, assinatura
      V1+V2 na geração do APK)
- [x] Orquestração da captura: **pronta e testada ponta a ponta** (fase-8
      §3.5). A conciliação congela o valor e publica `pendingCapture`; o app
      executa `efetivar`/`cancelar` no SDK e confirma via
      `POST /terminal/sessions/:id/capture-result` — com retomada após
      reinício (`pendingCaptureSessionId` no `/terminal/me`). Para exercitar
      no emulador: `BORA_TERMINAL_MOCK_CAPTURE_LOCATION=terminal` no backend

## O que já foi verificado — e o que não

**Compilado contra o SDK real (2026-10-09):** todo o código Kotlin — domínio,
API, cofre, `App` e os **dois** flavors — compila sem erro contra o `.aar`
oficial do PlugPag 1.35.0, num projeto de verificação JVM. As duas
inconsistências que o compilador apontou (o SDK declara `errorMessage` e
`customMessage` como texto nunca nulo — o caso real é texto vazio) foram
corrigidas. O Kotlin 1.9.24 do projeto lê o SDK (compilado em Kotlin 2.0)
sem problema: o app demo oficial do PagBank faz o mesmo com Kotlin 1.9.0.

**Ainda não verificado:** a `MainActivity` (depende de AppCompat/ViewBinding),
os recursos XML compilados e o APK montado — exigem o repositório do Google
(`dl.google.com`), bloqueado no ambiente onde o código foi escrito. O primeiro
build no Android Studio é o que fecha isso. O Gradle Wrapper (8.9, compatível
com o plugin Android 8.5.2) já está no projeto.

## O que a maquininha nunca faz (fase-8 §4)

- Nunca guarda ou transmite número completo de cartão, CVV ou trilha — os
  campos nem existem nos DTOs, e o backend recusa a requisição se aparecerem.
- Nunca escolhe conector, provedor ou valor da reserva: tudo vem do servidor
  (`GET /terminal/me`). Token furtado não liga o carregador do vizinho (R-32).
- Nunca captura no encerramento: a cobrança é da conciliação, depois da
  leitura final do medidor.

## Mapa dos arquivos

```
app/src/main/java/br/com/sonare/bora/pos/
├── App.kt                     # composição (cofre, backend, porta de pagamento)
├── MainActivity.kt            # desenha a tela do estado corrente
├── api/
│   ├── BoraApi.kt             # contrato HTTP fase-8 §3, endpoint por endpoint
│   ├── Dtos.kt                # espelho fiel das respostas reais da API
│   ├── ClienteBackend.kt      # Retrofit + Bearer token
│   └── CofreDeToken.kt        # token cifrado + chave de idempotência pendente
├── dominio/
│   └── FluxoRecarga.kt        # a máquina de estados (sem Android — testável)
└── pagamento/
    └── PagamentoPort.kt       # A PORTA. Uma implementação por flavor ↓

app/src/simulado/…/ProvedorPagamento.kt   # aprovação simulada (dev)
app/src/pagbank/…/ProvedorPagamento.kt    # PlugPag (equipamento PagBank)
```
