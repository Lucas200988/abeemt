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

## Situação da consulta

| Fornecedor | Contatado em | Respondeu | Atende                                                                        |
| ---------- | ------------ | --------- | ----------------------------------------------------------------------------- |
| PagBank    |              |           | ⏳ pendente — ver [arquitetura-de-cobranca.md §5](arquitetura-de-cobranca.md) |
|            |              |           |                                                                               |
|            |              |           |                                                                               |

**Nenhum fornecedor foi contatado até 2026-07-29.** A pesquisa registrada sobre o
PagBank vem de documentação pública e **não substitui a resposta deles** — o
portal de desenvolvedores bloqueia acesso automatizado.

Os pontos que estavam sem confirmação (captura parcial e operação não assistida)
ganharam **prova de mercado** — ver a seção no início deste documento. Isso muda o
tom da consulta: em vez de perguntar _"vocês conseguem fazer isso?"_, dá para
perguntar _"em que condições vocês fazem isso, que um concorrente já faz?"_.
