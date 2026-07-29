# ADR-0005 — Dinheiro em centavos e energia em Wh, sempre inteiros

- **Status:** Aceito
- **Data:** 2026-07-29
- **Fase:** 0

## Contexto

O sistema calcula valores a cobrar a partir de leituras de energia. Ponto
flutuante binário (IEEE 754) não representa exatamente valores decimais comuns:
`0.1 + 0.2 === 0.30000000000000004`. Em um sistema financeiro, isso produz
centavos que aparecem e desaparecem, totais que não fecham na conciliação e
disputas com o cliente que não têm explicação satisfatória.

O mesmo vale para energia: acumular `kWh` em `float` ao longo de centenas de
`MeterValues` propaga erro.

## Decisão

### Dinheiro

- Armazenado **exclusivamente** como inteiro de centavos (`Int` no Prisma,
  `integer`/`bigint` no PostgreSQL).
- Nomenclatura obrigatória com sufixo `Cents`: `pricePerKwhCents`,
  `connectionFeeCents`, `estimatedAmountCents`, `finalAmountCents`,
  `amountAuthorizedCents`, etc.
- Nenhuma operação monetária usa `Float`, `Double` ou `Decimal` do banco.
- Conversão para exibição acontece **apenas na borda de apresentação**
  (`Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`).

### Energia

- Armazenada como inteiro de **Wh**: `meterStartWh`, `meterStopWh`, `energyWh`.
- `MeterValue.value` é normalizado para Wh na ingestão; o payload cru original é
  preservado em `rawPayload` para auditoria.
- kWh existe apenas para exibição e para o cálculo tarifário, nesta ordem
  específica de operações.

### Regra de arredondamento

O cálculo tarifário é feito **inteiramente em aritmética inteira**, arredondando
uma única vez, no final:

```
custoEnergiaCents = round( energyWh * pricePerKwhCents / 1000 )
custoTempoCents   = round( durationSeconds * pricePerMinuteCents / 60 )
subtotalCents     = connectionFeeCents + custoEnergiaCents + custoTempoCents
finalCents        = clamp(subtotalCents, minimumAmountCents, maximumAmountCents)
```

`round` = arredondamento meio-para-cima (`Math.round` sobre o quociente inteiro,
implementado sem passar por float: `Math.trunc((a + b/2) / b)` com `a`, `b`
inteiros positivos). Arredondar apenas no fim evita acumular erro por parcela.

Se em algum momento a precisão exigir mais que 53 bits (não é o caso: R$ 90
trilhões em centavos ainda cabe em `Number.MAX_SAFE_INTEGER`), migra-se para
`BigInt` com ADR novo.

## Como isso é garantido (não basta ser regra escrita)

1. **Schema:** revisão obrigatória — nenhum campo monetário ou de energia pode
   ser `Float`/`Decimal`. Verificado a cada migration.
2. **Tipos:** `packages/contracts` expõe tipos nominais (`Cents`, `Wh`) para que
   passar um valor errado seja erro de compilação, não bug em produção.
3. **Testes:** a suíte de tarifação (FASE 6) cobre explicitamente:
   somente kWh; kWh + taxa fixa; somente tempo; valor mínimo aplicado; limite
   máximo aplicado; arredondamento em `.5`; sessão interrompida; medidor
   inconsistente; leituras repetidas; leitura final menor que a inicial.
4. **Determinismo:** dado o mesmo par (sessão, snapshot de tarifa), o valor
   calculado é sempre o mesmo — condição para conciliação e para o cliente
   confiar na conta.

## Alternativas consideradas

| Alternativa | Por que não |
| --- | --- |
| `Decimal` do PostgreSQL | Correto matematicamente, mas o Prisma o expõe como `Decimal.js`, contaminando toda a base com um tipo não-primitivo, e ainda permite conversão acidental para `number` |
| Biblioteca `dinero.js` | Útil, mas adiciona dependência para um problema que inteiros resolvem |
| `float` com arredondamento no final | É exatamente o bug que queremos impedir |

## Consequências

**Positivas**
- Impossível ter erro de centavo por representação.
- Comparações e somas são exatas.
- Conciliação com o adquirente fica direta.

**Negativas**
- Toda leitura precisa de conversão para exibir. Mitigado com helpers
  centralizados (`formatBRL`, `formatKwh`) usados por todo o frontend.
- Desenvolvedores desatentos podem exibir "3000" onde deveria ser "R$ 30,00".
  Mitigado pelos tipos nominais e pela ausência de formatação ad hoc.

**Neutras**
- Valores no banco são menos legíveis a olho nu numa consulta manual.
