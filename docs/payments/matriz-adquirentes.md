# Matriz de adquirentes — FASE 7

Formulário para comparar fornecedores. Preencha uma coluna por fornecedor
consultado, com a **resposta deles**, não com suposição.

Regra do briefing (18.24): não avançar para adquirente real antes da camada de
abstração. Ela está pronta — a `PaymentProvider` do
[ADR-0008](../architecture/adr/0008-pre-autorizacao-e-captura.md).

---

## Prova de mercado — a solução já existe

Registrado em 2026-07-29, a partir de publicação da **Go Electric E-Mobility**
divulgada em 16 de junho.

Uma operadora brasileira já roda **exatamente o modelo do
[ADR-0008](../architecture/adr/0008-pre-autorizacao-e-captura.md)**: terminal de
pagamento montado no próprio carregador, autoatendimento, sem aplicativo.

Descrição publicada por eles:

> 1. Você chega, conecta o plug ao veículo e **inicia o processo direto na tela
>    da maquininha**.
> 2. Aceita **cartão físico (com exigência de senha por segurança)** ou por
>    **aproximação (NFC) via celular ou smartwatch**.
> 3. O sistema faz uma **pré-autorização** no cartão e, ao final, **cobra apenas
>    o valor exato da energia** que o seu carro consumiu.

**O que isso confirma:**

| Critério                    | Situação                                             |
| --------------------------- | ---------------------------------------------------- |
| E1 · Pré-autorização        | ✅ existe em produção no Brasil                      |
| E2 · Captura parcial        | ✅ "cobra apenas o valor exato da energia consumida" |
| E3 · Operação não assistida | ✅ terminal no carregador, sem operador              |

Os três eliminatórios que estavam em aberto **são viáveis**. Deixa de ser aposta
técnica e passa a ser decisão econômica.

**Hardware:** o terminal aparente nas imagens tem etiqueta amarela com texto que
parece ser _"Moderninha Smart 2"_ — marca do PagBank. A leitura não é nítida na
resolução disponível; tratar como indício forte, não como certeza.

**Dois detalhes de projeto que eles resolveram bem:**

1. **Senha obrigatória no cartão físico.** Confirma a preocupação com o limite de
   valor por aproximação: pré-autorização de valor alto não passa em contactless
   sem autenticação.
2. **NFC por celular ou smartwatch como alternativa.** Carteira digital tem
   biometria, então não esbarra no limite de aproximação. Quem tem Apple Pay ou
   Google Pay encosta o telefone; quem usa cartão físico digita senha.

**E eles fazem os dois caminhos.** O adesivo no carregador mostra instruções em
três passos com QR Code — o fluxo por aplicativo. A maquininha foi **adicionada**
como alternativa para quem não quer app. Não substituiu; convive.

**O que a evidência NÃO responde:**

- Qual adquirente e sob quais condições contratuais. Uma operadora com várias
  estações negocia diferente de quem tem um carregador.
- Se usam o SDK do fabricante do terminal, e **onde a captura acontece** —
  no terminal ou pela API online.
- O terminal está sob cobertura (a estrutura de telhado aparece na imagem). Não é
  exposição total a chuva e sol.

Nada disso invalida a consulta formal aos fornecedores: a viabilidade está
provada, as **condições** ainda não.

---

## Critérios eliminatórios

Se a resposta for "não" em qualquer um destes, o fornecedor **não atende** o
modelo escolhido. Verifique estes primeiro, antes de discutir preço.

> A prova de mercado acima mostra que E1, E2 e E3 **são obteníveis**. Se um
> fornecedor disser que não faz, o problema é do fornecedor — não do modelo.

| #      | Critério                                           | Por que elimina                                                                                    |
| ------ | -------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **E1** | Pré-autorização (reservar sem cobrar)              | Sem isso não existe o modelo do ADR-0008                                                           |
| **E2** | **Captura parcial** — cobrar menos que o reservado | É o que permite "pague só o que consumiu". Capturar só o valor total não serve                     |
| **E3** | Operação **não assistida** permitida em contrato   | Não haverá operador no carregador                                                                  |
| **E4** | Webhook com **assinatura criptográfica**           | Sem verificar origem, qualquer um confirma pagamento falso                                         |
| **E5** | Pix com **devolução parcial via API**              | Obrigatório pela regra de consumo zero ([ADR-0010](../architecture/adr/0010-pix-valor-fixo.md) §4) |

> **E2 é o mais fácil de confundir.** Muitos dizem "sim, temos pré-autorização" e
> na prática só permitem capturar o valor cheio ou cancelar. Pergunte
> explicitamente: _"consigo reservar R$ 200 e capturar R$ 62,40?"_

---

## Matriz

| Critério                                                     | Fornecedor A | Fornecedor B | Fornecedor C |
| ------------------------------------------------------------ | ------------ | ------------ | ------------ |
| **Nome / produto**                                           |              |              |              |
| **Categoria** (adquirente, gateway, subadquirente, SmartPOS) |              |              |              |
| — **Eliminatórios**                                          |              |              |              |
| E1 · Pré-autorização                                         |              |              |              |
| E2 · Captura parcial                                         |              |              |              |
| E3 · Operação não assistida                                  |              |              |              |
| E4 · Webhook assinado                                        |              |              |              |
| E5 · Pix com devolução parcial                               |              |              |              |
| — **Capacidade técnica**                                     |              |              |              |
| API REST documentada                                         |              |              |              |
| Sandbox disponível                                           |              |              |              |
| SmartPOS Android com app próprio                             |              |              |              |
| SDK do terminal — qual                                       |              |              |              |
| Captura é feita no terminal ou pela API?                     |              |              |              |
| Validade da pré-autorização                                  |              |              |              |
| Cartão de débito com pré-autorização                         |              |              |              |
| Estorno / cancelamento de pré-autorização (void)             |              |              |              |
| Split de pagamento (futuro, fora do MVP)                     |              |              |              |
| Conciliação — arquivo ou API                                 |              |              |              |
| — **Comercial**                                              |              |              |              |
| Aluguel / compra do terminal                                 |              |              |              |
| MDR crédito                                                  |              |              |              |
| Taxa por transação Pix                                       |              |              |              |
| Taxa de pré-autorização (se houver)                          |              |              |              |
| Prazo de recebimento                                         |              |              |              |
| Volume mínimo exigido                                        |              |              |              |
| Prazo contratual / fidelidade                                |              |              |              |
| — **Operação**                                               |              |              |              |
| Prazo de homologação                                         |              |              |              |
| Suporte técnico no Brasil                                    |              |              |              |
| Documentação pública                                         |              |              |              |
| — **Veredito**                                               |              |              |              |
| Atende?                                                      |              |              |              |

---

## Roteiro para enviar ao fornecedor

Texto pronto para adaptar. Vale mandar por escrito e **guardar a resposta**: as
duas primeiras perguntas decidem o projeto, e vale ter registro do que foi dito.

> Assunto: Consulta técnica — pré-autorização em autoatendimento para recarga
> veicular
>
> Olá,
>
> Estamos desenvolvendo uma plataforma de pagamento para carregadores de veículos
> elétricos. O modelo é: o motorista chega, paga, carrega, e é cobrado **apenas
> pelo que consumiu**. Não há operador no local.
>
> Antes de avançar, precisamos confirmar seis pontos técnicos:
>
> 1. **Pré-autorização com captura parcial.** Conseguimos reservar, por exemplo,
>    R$ 200 no cartão e depois capturar apenas R$ 62,40, liberando o restante? Ou
>    a captura precisa ser do valor total reservado?
>
> 2. **Onde a captura acontece.** Se a pré-autorização for feita num terminal
>    físico, a captura posterior é feita no próprio terminal ou por API,
>    referenciando a transação?
>
> 3. **Operação não assistida.** O contrato permite o terminal instalado ao ar
>    livre, junto ao carregador, operado pelo próprio cliente, sem funcionário?
>
> 4. **Aplicativo próprio no terminal.** É possível instalar nosso aplicativo
>    Android no equipamento? Qual SDK, qual o processo e o prazo de homologação?
>
> 5. **Webhook.** A confirmação de transação é enviada por webhook? Com
>    assinatura criptográfica que possamos verificar?
>
> 6. **Pix.** É possível fazer devolução **parcial** de um Pix recebido, via API?
>
> Também gostaríamos de saber sobre ambiente de sandbox, prazo de validade da
> pré-autorização, custos (aluguel, MDR, taxas), volume mínimo e prazo
> contratual.
>
> Obrigado.

---

## Categorias a consultar

Vale consultar mais de uma categoria — os modelos comerciais são bem diferentes:

| Categoria                     | O que esperar                                                             |
| ----------------------------- | ------------------------------------------------------------------------- |
| **Adquirentes tradicionais**  | Melhor custo em volume; contrato e homologação mais pesados               |
| **Gateways / subadquirentes** | Integração mais rápida, API melhor documentada; custo por transação maior |
| **SmartPOS Android**          | Terminal onde o app roda; verificar E3 (não assistida) com atenção        |
| **PSP de Pix**                | Para o caminho Pix; E5 é o critério que importa                           |

---

## Rede — o que o portal do desenvolvedor confirmou (2026-07-31)

Levantado por você, a partir do Portal do Desenvolvedor Rede. Isto **não é
suposição**: veio da página oficial.

| Item                             | Confirmado                                                             |
| -------------------------------- | ---------------------------------------------------------------------- |
| Sandbox                          | ✅ existe, **gratuito**, e **não exige vínculo contratual** para criar |
| Como obter credencial            | Criar conta → "Meus Projetos" → criar projeto → credencial automática  |
| Autenticação                     | **OAuth 2.0** — `clientId` + `clientSecret` geram um token de acesso   |
| Prazo da migração para OAuth 2.0 | 05/01/2026 — **já passou**; OAuth 2.0 é o padrão atual                 |
| Ferramenta de teste              | Coleção Postman baixável por projeto                                   |

### Consequência técnica: OAuth 2.0 muda a forma da credencial

O `HttpPaymentProvider` de hoje foi escrito para um **token estático** no
cabeçalho — o modelo do PagBank. A Rede usa **client credentials**: duas chaves
que são trocadas por um token de curta duração, que precisa ser renovado.

Não é obstáculo — é padrão de mercado (RFC 6749) e cabe na mesma base HTTP. Mas
significa que o adapter da Rede precisa de **obtenção e renovação de token**, e
que as variáveis de ambiente serão duas chaves, não um token. **Só será escrito
quando houver documentação lida** (risco R-31).

### Os pacotes de API oferecidos, e o que cada um é

Vistos na tela de criação de projeto:

| Pacote                           | Serve para nós?                                                  |
| -------------------------------- | ---------------------------------------------------------------- |
| **e.Rede**                       | ✅ **é este** — autorização e captura de cartão pela API da Rede |
| Gateway de Pagamento (maxiPago!) | Alternativa de gateway; segunda opção a avaliar                  |
| Link de Pagamento                | Cobrança por link — não serve para terminal autoatendido         |
| Chargeback                       | Contestação de cobrança; útil depois, não agora                  |
| Credenciamento                   | Abertura de estabelecimento                                      |
| Gestão de Acessos / de Vendas    | Administrativo                                                   |

### Descoberta importante: o SDK da maquininha **não está neste portal**

Nenhum dos pacotes acima é o SDK do SmartPOS. Este portal entrega as **APIs de
servidor**. O aplicativo que roda **dentro** do equipamento é outro canal — a
**Rede Store**, cujo contato é `DevSmartRede@userede.com.br`.

São duas trilhas separadas, e a FASE 8 (caminho A) precisa das duas:

```
Rede Store (DevSmartRede@)  →  aplicativo que roda na maquininha
e.Rede (portal + sandbox)   →  autorizar e capturar o cartão
```

**Isto não invalida o que foi construído.** A arquitetura já tem os dois
caminhos, e a escolha entre eles é uma linha de configuração:

- se o SDK do terminal fizer pré-autorização e captura parcial →
  `recordTerminalAuthorization` (o que a FASE 8 entregou)
- se não fizer → a maquininha só lê o cartão, e quem autoriza e captura é o
  nosso servidor via e.Rede → `startPaidSession`, o caminho da FASE 5

A pergunta que decide qual dos dois vale continua **aberta** e é o que trava o
aplicativo da maquininha.

---

## PagBank — o que o Portal do Desenvolvedor confirmou (2026-08-03)

Lucas navegou o portal logado e trouxe o conteúdo. O que passou de suposição a
fato está agora em `CONTRATO`, em `packages/payment-core/src/pagbank.ts`.

**Antes de tudo, uma distinção que evita trabalho errado:** nada nesta seção é
o caminho da maquininha. O portal documenta as APIs **online** (servidor →
PagBank). No caminho A — aplicativo dentro do SmartPOS — quem fala com o
PagBank é o SDK PlugPag no próprio equipamento (§8.1-B de
[fase-8-maquininha.md](fase-8-maquininha.md)), e o nosso servidor não faz a
autorização. As duas coisas coexistem: o portal continua valendo para
conciliação, consulta e para o caminho B (pagamento online por QR Code).

### Ambientes e credencial

| Item                 | Valor                               |
| -------------------- | ----------------------------------- |
| Produção             | `https://api.pagseguro.com`         |
| Teste (sandbox)      | `https://sandbox.api.pagseguro.com` |
| Credencial           | `Authorization: Bearer <token>`     |
| Versão da plataforma | "Nova Plataforma", OpenAPI 4.1      |

Os dados do sandbox são fictícios e não afetam contabilidade real. O portal
fornece **tokens de teste** e uma tabela de **cartões de teste** com regras que
provocam respostas específicas — o equivalente à tabela que usamos para forçar
a recusa no sandbox da Rede.

### Chave pública — o que mantém o cartão fora do nosso servidor

Esta é a descoberta que importa para a seção 12 do briefing. O PagBank publica
uma chave pública por conta; o cartão é criptografado **no cliente** com ela, e
o que chega ao nosso backend é um blob cifrado, nunca o número.

| Operação  | Método | Caminho             | Nota                                                      |
| --------- | ------ | ------------------- | --------------------------------------------------------- |
| Criar     | POST   | `/public-keys`      | corpo `{ "type": "card" }` → `{ public_key, created_at }` |
| Consultar | GET    | `/public-keys/card` |                                                           |
| Alterar   | PUT    | `/public-keys/card` | a chave antiga vale mais **7 dias** após a troca          |

É o análogo exato do `cardToken` da Rede, e é o que também habilita **3DS** —
exigido para débito. Por isso o `authorize()` do adapter passou a **recusar**
autorização sem `metadata.encryptedCard`: no PagBank, como na Rede, o número
completo não tem porta de entrada no nosso código.

A janela de 7 dias na troca de chave é operacionalmente relevante: dá para
girar a chave sem derrubar pagamentos em andamento, desde que a troca e a
atualização do cliente aconteçam dentro dela.

### Serviços que existem, e quais nos interessam

| Serviço                | Serve para nós?                                                         |
| ---------------------- | ----------------------------------------------------------------------- |
| API de Pedido          | ✅ é o caminho da pré-autorização online (`capture: false`)             |
| Chaves públicas        | ✅ obrigatório — criptografia do cartão e 3DS                           |
| Certificado digital    | ⚠️ mTLS como fator adicional; avaliar na homologação                    |
| EDI                    | ⚠️ extrato eletrônico para conciliação — útil quando houver volume      |
| Connect                | ❌ é para agir em nome de contas de terceiros (marketplace)             |
| API de Cadastro        | ❌ criar contas em nome de terceiros                                    |
| Pagamentos Recorrentes | ❌ assinatura, não é o nosso modelo                                     |
| Checkout PagBank       | ❌ redireciona para página do PagBank; não cabe numa tela de carregador |
| API de Transferência   | ❌ movimentação de saldo                                                |

### Homologação — o portão que ninguém pula

O processo declarado pelo próprio portal é: documentação → testes no Portal do
Desenvolvedor → **contato com o time de integração para validar o ambiente**.
Ou seja, mesmo com tudo funcionando no sandbox, produção só abre depois de uma
validação humana. Isso entra no checklist do piloto pelo mesmo motivo que o
credenciamento da Rede entrou: é prazo de terceiro, não de código.

### Sandbox — já existe conta, e já dá para gerar cartão criptografado

Conta de teste ativa em `portaldev.pagbank.com.br` (Lucas, 2026-08-03). O portal
tem: **Tokens**, **Transações**, **Logs** e **Cartões teste**.

Os cartões fictícios estão registrados em `CARTOES_DE_TESTE_SANDBOX`
(`packages/payment-core/src/pagbank.ts`): **aprovação e recusa**, uma dupla por
bandeira — Visa, Mastercard, Amex, Elo e Hiper —, CVV `123`, validade
`12/2030`. Ter cartão de recusa por bandeira é melhor do que tivemos na Rede,
onde o cartão de recusa teve que ser descoberto na tentativa e erro; um teste
garante que as duas listas cobrem as mesmas bandeiras.

O portal também tem um **gerador de criptografia**: você cola a chave pública de
sandbox e os dados do cartão de teste, e ele devolve o blob cifrado. É de lá que
sai o `metadata.encryptedCard` para exercitar o adapter.

### O que continua "a confirmar", e qual página fecha cada item

O índice da referência (`developer.pagbank.com.br/reference/introducao`) mostra a
estrutura, mas as páginas de cada endpoint não foram abertas. Caminho de
pagamento suposto é exatamente o tipo de coisa que só se descobre errada com
dinheiro de motorista, então a trava `BORA_PAGBANK_VERIFIED` permanece fechada.

| Pendência                                                            | Página da referência que responde                                        |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Caminhos de pedido, captura, cancelamento                            | `reference/criar-pedido` ("Gerencie pedidos e pagamentos", 12 endpoints) |
| Mapa de estados, `summary.paid`, `summary.refunded`, dados do cartão | `reference/objeto-charge`                                                |
| Nome do campo do cartão criptografado                                | `reference/objeto-charge` ou `reference/casos-de-uso`                    |
| Cabeçalho de assinatura do webhook                                   | `reference/webhooks`                                                     |
| Tratamento de recusa                                                 | `reference/motivos-de-compra-negada`                                     |
| Erros e retentativa                                                  | `reference/codigos-de-erro-order`                                        |

`reference/casos-de-uso` tem 33 casos e quase certamente inclui o de
pré-autorização — é o atalho mais provável para fechar vários itens de uma vez.

### Confirmação por ausência: o SmartPOS não está nesta referência

A árvore inteira da referência — Chaves Públicas, Connect, Certificado digital,
Cadastro, Pedidos & Pagamentos, Checkout, Recorrente, ClubPag — **não tem seção
de maquininha**. Isso reforça o que o SDK PlugPag já indicava: o caminho A vive
fora deste portal, no SDK Android, e depende do processo comercial. Ler tudo
aqui não destrava a maquininha.

---

## Situação da consulta

| Fornecedor            | Contatado em                                                      | Respondeu                                | Atende                                                                                                                                                                                                                                                                                             |
| --------------------- | ----------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PagBank               | 2026-08-01                                                        | **SDK PlugPag lido na íntegra (GitHub)** | ✅ SmartPOS com pré-autorização NO EQUIPAMENTO: `doPreAutoCreate` / `doEffectuatePreAuto(amount)` / `doPreAutoCancel`, valores em centavos, Android Java/Kotlin, Loja de Aplicativos própria. Processo: formulário de parceria → equipamento de dev → homologação. Ver fase-8-maquininha.md §8.1-B |
| Rede (portal e.Rede)  | 2026-07-31                                                        | **✅ VERIFICADO no sandbox: 8/8**        | Escolhido. Pré-autorização + captura parcial provadas no adquirente real — ver [rede-e-rede-contrato.md §9](rede-e-rede-contrato.md)                                                                                                                                                               |
| Rede Store (SmartPOS) | **2026-07-31** (e-mail de Lucas para DevSmartRede@userede.com.br) | aguardando                               | ⏳ 5 perguntas enviadas: publicação na Rede Store, pré-autorização + captura parcial no SDK, modo quiosque, homologação, modelo para uso externo                                                                                                                                                   |

**Nenhum fornecedor foi contatado até 2026-07-29.** A pesquisa registrada sobre o
PagBank vem de documentação pública lida por Lucas no portal logado e do SDK
PlugPag no GitHub — **não substitui a resposta comercial deles**, que é o que
libera equipamento de desenvolvimento e homologação. O portal continua
bloqueando acesso automatizado a partir daqui (HTTP 403).

Os pontos que estavam sem confirmação (captura parcial e operação não assistida)
ganharam **prova de mercado** — ver a seção no início deste documento. Isso muda o
tom da consulta: em vez de perguntar _"vocês conseguem fazer isso?"_, dá para
perguntar _"em que condições vocês fazem isso, que um concorrente já faz?"_.
