# Como a cobrança vai funcionar

Documento para responder três perguntas concretas: **como o motorista paga**,
**o que a plataforma faz em cada passo**, e **o que muda no código** conforme o
caminho escolhido.

Escrito em 2026-07-29, ao fim da FASE 3.

---

## 1. O ponto que resolve a ansiedade

**A escolha da maquininha não trava o desenvolvimento.**

| O que precisa ser construído                                   | Depende do fornecedor?             |
| -------------------------------------------------------------- | ---------------------------------- |
| Porta `PaymentProvider` (autorizar/capturar/cancelar/devolver) | ❌ Não                             |
| `MockPaymentProvider` e webhook simulado (FASE 5)              | ❌ Não                             |
| Máquina de estados do pagamento                                | ❌ Não                             |
| Idempotência de webhook                                        | ❌ Não                             |
| Parada automática no teto (risco R-22)                         | ❌ Não                             |
| Cálculo de tarifa e valor final (FASE 6)                       | ❌ Não                             |
| **Adapter concreto do adquirente** (FASE 7)                    | ✅ Sim — **1 arquivo**             |
| **Interface do motorista** (FASE 8)                            | ✅ Sim — app Android ou página web |

Ou seja: dá para construir **tudo** até a FASE 6 sem decidir nada de hardware.
Quando a decisão vier, o que muda é um adapter que implementa uma interface já
definida.

Foi exatamente para isso que o [ADR-0004](../architecture/adr/0004-payment-provider-port.md)
existe, e é a regra 24 do seu briefing: não escolher adquirente antes da camada
de abstração.

---

## 2. Os dois caminhos possíveis

### Caminho A — SmartPOS com aplicativo nosso

Terminal Android fixado no carregador. O motorista opera o terminal.

```
Motorista chega
   │
   ├─► toca na tela do terminal
   │
   ├─► nosso app lista os conectores  ──────► GET /api/v1/terminal/connectors
   │                                          (o terminal se identifica por credencial)
   ├─► motorista escolhe o conector
   │
   ├─► app chama o SDK do terminal:
   │     "pré-autorizar R$ 200"
   │
   ├─► motorista aproxima o cartão + senha
   │
   ├─► SDK devolve: aprovado, NSU, cód. autorização, bandeira, 4 últimos dígitos
   │
   ├─► app envia isso ao backend ──────────► POST /api/v1/payments/confirm
   │                                          (com chave de idempotência)
   │
   ├─► backend cria Payment(AUTHORIZED)
   │            e   Session(PAYMENT_APPROVED)
   │
   ├─► backend envia RemoteStartTransaction ──► carregador   ✅ JÁ FUNCIONA
   │
   ├─► recarga acontece; MeterValues chegam   ✅ JÁ FUNCIONA
   │
   ├─► ao atingir 95% do teto → parada automática        (FASE 5)
   │   ou motorista/veículo encerra
   │
   ├─► StopTransaction → energia final        ✅ JÁ FUNCIONA
   │
   ├─► backend calcula o valor                            (FASE 6)
   │
   └─► backend CAPTURA R$ 62,40 → Payment(CAPTURED)       (FASE 7)
```

**O que precisa ser construído:** aplicativo Android (FASE 8, Caminho A) +
adapter do adquirente + endpoints de terminal.

**Risco específico:** um terminal ao ar livre, sem ninguém por perto, sujeito a
chuva, sol, furto e vandalismo.

**Este caminho está provado em produção** por uma operadora brasileira — ver
[matriz-adquirentes.md](matriz-adquirentes.md), "Prova de mercado". O que resta
confirmar não é a viabilidade, e sim **as condições comerciais** que cada
fornecedor oferece.

---

### Caminho C — QR Code e navegador do motorista

Sem hardware de pagamento. Um adesivo com QR Code no carregador.

```
Motorista chega
   │
   ├─► escaneia o QR do carregador
   │     https://carrega.sonare.com.br/c/A7K2
   │
   ├─► abre no navegador do celular dele
   │     SEM aplicativo. SEM cadastro. SEM login.
   │
   ├─► página mostra: conectores disponíveis, tarifa, teto
   │
   ├─► motorista escolhe conector e confirma
   │
   ├─► escolhe como pagar:
   │      ├── Pix  → QR dinâmico ou copia-e-cola, paga no app do banco
   │      └── Cartão → checkout do gateway, com pré-autorização
   │
   ├─► gateway confirma ────────────────────► POST /api/v1/webhooks/{provider}
   │                                          (assinado, idempotente)
   ├─► backend cria Payment + Session
   │
   ├─► backend envia RemoteStartTransaction ──► carregador   ✅ JÁ FUNCIONA
   │
   ├─► a MESMA página vira tela de acompanhamento:
   │     energia subindo, tempo, valor parcial
   │     (o celular do motorista no bolso, ele confere quando quiser)
   │
   ├─► StopTransaction → energia final        ✅ JÁ FUNCIONA
   │
   ├─► valor calculado, captura                            (FASES 6 e 7)
   │
   └─► comprovante na mesma página
```

**O que precisa ser construído:** página pública do motorista (FASE 8, Caminho B)
e o adapter do gateway. **Zero hardware.**

**Vantagem que costuma passar despercebida:** o celular do motorista vira a tela
de acompanhamento. Numa maquininha ele paga e vai embora — não fica olhando o
terminal. No celular ele acompanha a recarga, recebe o comprovante, e sabe quando
acabou. É experiência melhor, não pior.

**Desvantagem real:** depende do celular do motorista ter internet. "Sem
aplicativo" não é o mesmo que "sem celular".

---

## 3. Comparação honesta

|                                    | Caminho A — SmartPOS                    | Caminho C — QR/navegador          |
| ---------------------------------- | --------------------------------------- | --------------------------------- |
| Custo por ponto                    | Terminal (aluguel ou compra)            | R$ 0 — um adesivo                 |
| Prazo para começar                 | Homologação da adquirente + app Android | Semanas, sem depender de terceiro |
| Atende quem não tem celular        | ✅ Sim                                  | ❌ Não                            |
| Funciona sem internet do motorista | ✅ Sim                                  | ❌ Não                            |
| Exposição a furto/vandalismo       | ⚠️ Terminal ao relento                  | ✅ Nada a roubar                  |
| Manutenção em campo                | Bateria, papel, travamento, chuva       | Nenhuma                           |
| Acompanhamento da recarga          | Só no terminal                          | ✅ No bolso do motorista          |
| Operação não assistida permitida?  | ✅ **Provado em produção**              | Não se aplica                     |
| Pré-autorização + captura parcial  | ✅ **Provado em produção**              | Depende do gateway                |
| Limite de valor por aproximação    | Resolvido com senha ou carteira digital | Depende do checkout               |

---

## 4. Recomendação — revisada em 2026-07-29

> **Revisão.** A primeira versão deste documento recomendava o Caminho C pesando,
> entre outros fatores, que o Caminho A tinha viabilidade **não confirmada**.
> Surgiu prova de mercado — uma operadora brasileira já roda o Caminho A em
> produção (ver [matriz-adquirentes.md](matriz-adquirentes.md), "Prova de
> mercado"). Esse risco caiu, e a recomendação precisa ser reponderada com
> honestidade.

**A escolha deixou de ser técnica e passou a ser econômica.** Os dois caminhos
funcionam. O que os separa agora é capital, prazo e alcance.

### O que continua favorecendo o Caminho C

1. **Custo fixo zero por ponto.** Num MVP validando se alguém vai usar, alugar
   terminal antes de ter receita é assumir custo cedo.
2. **Pode ser construído agora**, sem depender de homologação de fornecedor.
3. **Reversível.** A porta `PaymentProvider` é a mesma; o SmartPOS entra depois
   como segundo canal, sem refazer domínio.

### O que passou a favorecer o Caminho A

1. **Viabilidade provada por um concorrente**, não suposta.
2. **Alcance maior.** Atende quem não tem celular, dados ou bateria. É a
   premissa "sem aplicativo" cumprida de forma mais completa — o navegador ainda
   exige um smartphone com internet.
3. **Possível expectativa de mercado.** Se o pagamento direto no totem virar
   padrão, ser só-QR pode passar a ser desvantagem competitiva.

### Como decidir

| Se a prioridade for…                               | Caminho                       |
| -------------------------------------------------- | ----------------------------- |
| Validar o negócio com o menor capital possível     | **C** — QR/navegador          |
| Cobertura máxima de motorista desde o primeiro dia | **A** — SmartPOS              |
| Acompanhar o que o mercado está fazendo            | **A**, com C como complemento |

**O que o concorrente fez, e vale copiar:** eles têm os **dois**. O adesivo com
QR para quem usa o aplicativo deles, e a maquininha adicionada depois para quem
não quer app. Não é escolha excludente — é ordem de implementação.

**Recomendação prática:** construa a FASE 5 e 6 (que não dependem de nada disso),
e use esse tempo para obter as condições comerciais. Com o custo real do terminal
na mão, a decisão deixa de ser sobre risco e passa a ser sobre número.

---

## 5. Se for PagBank — o que verifiquei

Consulta feita em 2026-07-29. **O portal de desenvolvedores bloqueia acesso
automatizado**, então parte disto vem de resultados de busca e **não de leitura
direta da documentação**. Trate como indício, não como fato confirmado.

> **Atualização.** Uma operadora brasileira já roda este modelo em produção, e o
> terminal aparente nas imagens parece ser uma **Moderninha Smart 2** — marca do
> PagBank. Se confirmado, os itens marcados abaixo como "confirmar" estão
> respondidos na prática. Ver [matriz-adquirentes.md](matriz-adquirentes.md).

| Item                               | O que encontrei                                                                                                                                       | Confiança               |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Instalar app próprio no terminal   | Sim — biblioteca `PlugPagServiceWrapper`, para integrar aplicativos Android à **Moderninha Smart**                                                    | Alta                    |
| Modelo do terminal                 | Só as linhas **Android/Smart**. Minizinha e Moderninha Pro/Plus **não** são plataforma de aplicativo                                                  | Alta                    |
| Processo de homologação            | Existe seção própria "Smart POS — processo de integração". Não é instalação livre                                                                     | Alta                    |
| Pré-autorização no SDK do terminal | Indícios de que o PlugPag tem funções de pré-autorização                                                                                              | **Baixa — confirmar**   |
| Captura parcial                    | A documentação de "pré-autorizar e capturar parcialmente" que encontrei é da **API online (Orders)**, não do SDK do terminal. São produtos diferentes | **Baixa — confirmar**   |
| Operação não assistida             | Nada encontrado                                                                                                                                       | **Nenhuma — confirmar** |

### As perguntas que decidem

Mande estas ao PagBank **antes de comprar ou alugar qualquer equipamento**. As
duas primeiras são eliminatórias:

1. O **PlugPag, rodando na Moderninha Smart**, faz **pré-autorização** e
   **captura de valor parcial** (menor que o reservado)? Ou só venda à vista?
2. Se a pré-autorização é feita no terminal, **a captura é feita onde** — no
   próprio terminal, ou pela API online usando o identificador da transação?
3. O contrato permite **operação não assistida**, com o terminal instalado ao ar
   livre junto a um carregador veicular, sem operador?
4. Qual o **prazo de homologação** do aplicativo próprio, e como é a
   distribuição dele no terminal?
5. **Webhook com assinatura criptográfica** para confirmação assíncrona?
6. **Pix com devolução parcial via API** — obrigatório pela nossa regra de
   consumo zero ([ADR-0010](../architecture/adr/0010-pix-valor-fixo.md) §4).
7. Qual a **validade** de uma pré-autorização antes de expirar?
8. **Cartão de débito** suporta pré-autorização?
9. Existe **sandbox**?
10. Custos: aluguel do terminal, MDR, taxa por transação, taxa de
    pré-autorização, volume mínimo, prazo contratual.

**Se a resposta 1 for "não"**, existe saída sem trocar de fornecedor: aplicar ao
cartão o **mesmo modelo já decidido para Pix** — valor fixo pré-pago com parada
automática no valor pago. Fica coerente, e torna o PagBank viável. Mas desfaz
parte do [ADR-0008](../architecture/adr/0008-pre-autorizacao-e-captura.md) para
cartão, então é decisão sua, não minha.

---

## 6. O que já está pronto

Para não haver dúvida sobre o que falta:

| Etapa do fluxo                                         | Situação            |
| ------------------------------------------------------ | ------------------- |
| Receber confirmação de pagamento                       | ⬜ FASE 5           |
| Identificar carregador e conector                      | ✅ pronto           |
| Enviar `RemoteStartTransaction`                        | ✅ pronto e testado |
| Carregador iniciar a recarga                           | ✅ pronto           |
| Receber `StartTransaction` e `MeterValues`             | ✅ pronto           |
| Monitorar a sessão                                     | ✅ pronto           |
| Parada automática no teto                              | ⬜ FASE 5           |
| Encerrar (`RemoteStopTransaction` / `StopTransaction`) | ✅ pronto           |
| Calcular energia                                       | ✅ pronto           |
| Calcular valor                                         | ⬜ FASE 6           |
| Capturar o pagamento                                   | ⬜ FASE 7           |
| Registrar tudo e mostrar no painel                     | ✅ pronto           |

**O meio do fluxo — a parte OCPP, que é a difícil — está funcionando e testado.**
O que falta é a ponta financeira, e ela não depende da maquininha até a FASE 7.
