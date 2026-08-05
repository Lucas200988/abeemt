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

Celular físico em vez de emulador: troque `BORA_BASE_URL` no
`app/build.gradle.kts` pelo IP da sua máquina na rede local.

## Flavor `pagbank` — o que ainda falta

O wrapper do PlugPag é distribuído pelo **GitHub Packages do PagBank** e exige
autenticação. Em `~/.gradle/gradle.properties`:

```
gpr.user=SEU_USUARIO_GITHUB
gpr.token=SEU_TOKEN_GITHUB_COM_read_packages
```

Além da credencial, o flavor depende do que está em andamento com o PagBank:

- [ ] Parceria aprovada (formulário enviado; homologação da API já aprovada —
      chamado 1424039934)
- [ ] Terminal de desenvolvimento recebido
- [ ] **Assinaturas do PlugPag confirmadas no equipamento** — o código do
      flavor está marcado `PROCEDÊNCIA: A CONFIRMAR`, como no CONTRATO do
      backend: foi escrito lendo o repositório oficial do wrapper, e o briefing
      §18 proíbe presumir que biblioteca funciona sem teste
- [ ] Captura **parcial** validada no equipamento (reserva 500 / captura 100,
      como no teste de produção da API)
- [ ] Orquestração da captura: hoje a conciliação do backend captura via API;
      com PlugPag a pré-autorização vive no equipamento, então o backend
      precisará mandar o terminal executar o `efetivar` (a porta já existe;
      falta o comando no contrato HTTP)

## Estado honesto deste esqueleto

Escrito e revisado neste repositório, mas **ainda não compilado**: o ambiente
onde foi gerado não tem Android SDK. A primeira abertura no Android Studio pode
pedir ajustes menores (versões de plugin, wrapper do Gradle — gere com
`gradle wrapper` ou deixe o Studio criar). Nada disso muda a arquitetura.

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
