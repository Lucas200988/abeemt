# FASE 7 — o que falta, e quem destrava

> **CONCLUÍDA PARA A REDE — 2026-07-31.** O fornecedor escolhido é a **Rede**.
> O manual v1.38 foi lido na íntegra, o adapter foi escrito com o contrato
> confirmado, e a verificação contra o **sandbox real** passou com **8 de 8**
> passos — incluindo a prova central do produto: R$ 200,00 reservados e
> R$ 8,00 capturados. Evidência e ressalvas em
> [rede-e-rede-contrato.md §9](rede-e-rede-contrato.md).
>
> Este documento permanece como registro histórico e continua valendo para o
> PagBank, cujo adapter segue travado e não verificado.

A FASE 7 pede "sandbox aprovando e iniciando recarga, webhook assinado". Isso
**não aconteceu**, e este documento diz exatamente por quê e o que resolve.

---

## 1. Por que a fase não fecha sozinha

O portal de documentação do PagBank **recusa acesso automatizado** — HTTP 403,
verificado em 2026-07-31 em `developer.pagbank.com.br` e em `docs.pagar.me`.
Sem conseguir ler o contrato, escrever caminhos e nomes de campos por suposição
produziria código que **parece** pronto e não é. Em pagamento, isso é o pior
resultado possível: pior do que não escrever, porque passa despercebido.

Some-se a isso a regra 18.20 do briefing: **não fazer chamada real de pagamento
sem ambiente de testes do fornecedor**. Não temos credenciais.

Então a fase foi dividida no que dá para provar hoje e no que depende de você.

---

## 2. O que ficou pronto e testado

| Entrega                                                     | Onde                                       | Testes |
| ----------------------------------------------------------- | ------------------------------------------ | ------ |
| Suíte de conformidade da porta                              | `packages/payment-core/src/conformance.ts` | 30     |
| Base HTTP (prazo, retentativa, idempotência, HMAC, redação) | `http-provider.ts`                         | 20     |
| Adapter PagBank (estrutura, trava, mapeamento, webhook)     | `pagbank.ts`                               | 13     |
| Corpo cru do webhook, ponta a ponta                         | `main.ts`, controller, serviço             | —      |

### A suíte de conformidade

É o contrato que **todo** adapter precisa cumprir, escrito uma vez. Hoje roda
contra `mock` e `manual`. No dia em que houver sandbox, o adapter real entra com
**uma linha** e passa a ser cobrado pelas mesmas regras:

```ts
runProviderConformance('pagbank', () => new PagBankProvider({ ... }));
```

### O que a base HTTP resolve, e por quê

- **Retentativa só no recuperável.** Erro de rede, 5xx e 429 são repetidos; **4xx
  não**. Repetir uma recusa não muda o resultado, pode disparar antifraude e é
  assim que se cria cobrança duplicada.
- **Chave de idempotência propagada.** Uma retentativa depois de um prazo
  estourado não pode virar segundo pagamento.
- **Assinatura sobre os bytes originais.** Reconverter o JSON muda espaçamento e
  ordem de chaves; a assinatura deixaria de bater **sempre**. O Nest agora
  guarda o corpo cru (`rawBody: true`).
- **Comparação em tempo constante.** Comparar assinatura com `===` vaza, pelo
  tempo de resposta, quantos caracteres iniciais estão certos.
- **Credencial nunca em log.** Bibliotecas de HTTP incluem URL e cabeçalhos nas
  mensagens de erro; sem limpeza, o token vaza para o log (risco R-15).

### A trava

Enquanto `BORA_PAGBANK_VERIFIED` não for `true`:

- o adapter **recusa toda operação**, com mensagem dizendo o que falta;
- a API **não sobe** se ele for o provedor padrão.

Um adapter não verificado operando é como se descobre a divergência com dinheiro
de motorista.

---

## 3. O que só você destrava

### 3.1 Credenciais de sandbox

Abra conta de desenvolvedor no PagBank (ou no adquirente escolhido) e obtenha:

- endereço base do sandbox
- token de acesso do sandbox
- segredo usado para assinar os webhooks

**Não me mande as credenciais por aqui.** Coloque no `.env` da máquina onde o
sistema roda:

```
BORA_PAGBANK_BASE_URL=https://sandbox.api.pagseguro.com
BORA_PAGBANK_TOKEN=<token do sandbox>
BORA_PAGBANK_WEBHOOK_SECRET=<segredo>
BORA_PAGBANK_VERIFIED=false
```

Credencial nunca entra em arquivo versionado (regra 18.13).

### 3.2 A escolha do fornecedor

A [matriz de adquirentes](matriz-adquirentes.md) tem os cinco critérios
eliminatórios e o roteiro de e-mail. A decisão é econômica, não técnica: os três
critérios que eram dúvida (pré-autorização, captura parcial, operação não
assistida) já foram confirmados como viáveis no Brasil.

### 3.3 As respostas do contrato

Com a documentação aberta, estes são os itens a confirmar em
`packages/payment-core/src/pagbank.ts`, no objeto `CONTRATO`:

| Item                                 | Pergunta                                                          |
| ------------------------------------ | ----------------------------------------------------------------- |
| `baseUrlSandbox` / `baseUrlProducao` | Quais os endereços exatos?                                        |
| `criarPedido`                        | Qual caminho cria o pedido com pré-autorização?                   |
| `capturar`                           | Qual caminho captura, e o que identifica a cobrança?              |
| `cancelar`                           | Cancelar reserva e devolver valor capturado usam o mesmo caminho? |
| `devolver`                           | Se forem diferentes, qual é cada um?                              |
| `consultar`                          | Qual caminho consulta uma cobrança?                               |
| `campoValor` / `campoMoeda`          | Os valores vão em centavos? Em que campo?                         |
| `cabecalhoAssinatura`                | Qual cabeçalho traz a assinatura do webhook?                      |
| `mapaDeEstados`                      | Quais estados o fornecedor devolve, e o que cada um significa?    |

**Já confirmado** (de material público do PagBank): pré-autorização é
`capture: false`; a reserva vale de 6 a 29 dias conforme a bandeira;
`capture_before` define o prazo; captura parcial existe.

---

## 4. O roteiro do dia em que o sandbox chegar

1. Preencher o `CONTRATO` com as respostas acima.
2. Acrescentar o adapter à suíte de conformidade e rodar contra o sandbox.
3. Corrigir o que a suíte apontar. **Ela é o critério** — não "parece que
   funcionou".
4. Exercitar o webhook: apontar o sandbox para a URL pública, conferir que
   assinatura válida passa e adulterada é recusada.
5. Só então `BORA_PAGBANK_VERIFIED=true`.
6. Uma recarga completa ponta a ponta no sandbox: reserva, consumo, captura
   parcial, e a diferença liberada.

Estimativa depois das credenciais: **algumas horas**, não dias — porque tudo o
que não depende do fornecedor já está pronto e testado.

---

## 5. Riscos

**R-31 (novo) — adapter escrito sem contrato verificado.** Pode divergir do real
em caminhos, nomes de campos e estados. Mitigado por: isolamento em `CONTRATO`,
trava de ativação, suíte de conformidade e mapeamento conservador (estado
desconhecido vira falha, nunca sucesso).

**R-23 — pré-autorização expira antes da captura.** O adapter declara
`authorizationValidityDays: 6`, o pior caso conhecido, para o alerta disparar
cedo o bastante. Confirmar o prazo real por bandeira no contrato.
