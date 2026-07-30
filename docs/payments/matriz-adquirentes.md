# Matriz de adquirentes — FASE 7

Formulário para comparar fornecedores. Preencha uma coluna por fornecedor
consultado, com a **resposta deles**, não com suposição.

Regra do briefing (18.24): não avançar para adquirente real antes da camada de
abstração. Ela está pronta — a `PaymentProvider` do
[ADR-0008](../architecture/adr/0008-pre-autorizacao-e-captura.md).

---

## Critérios eliminatórios

Se a resposta for "não" em qualquer um destes, o fornecedor **não atende** o
modelo escolhido. Verifique estes primeiro, antes de discutir preço.

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
portal de desenvolvedores bloqueia acesso automatizado, e os pontos críticos
(captura parcial no terminal, operação não assistida) ficaram sem confirmação.
