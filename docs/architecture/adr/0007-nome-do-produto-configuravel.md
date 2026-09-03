# ADR-0007 — Marca do produto configurável ("Borá Carregar")

- **Status:** Aceito
- **Data:** 2026-07-29
- **Fase:** 0

## Contexto

O nome **"Borá Carregar"** é explicitamente provisório e o briefing exige que
"o nome deverá ser fácil de alterar futuramente". Nomes de produto costumam se
espalhar por títulos de página, e-mails, rodapés, `package.json`, nomes de
container, prefixos de log e cabeçalhos de API — e depois a renomeação vira uma
caçada por strings em todo o repositório.

Há também uma distinção útil: **nome do produto** (voltado ao usuário, muda) e
**nome técnico do sistema** (`sonare-charge`, usado em pacotes e infraestrutura,
tende a ser estável).

## Decisão

Separar os dois e centralizar o nome do produto em um único lugar.

### 1. Nome técnico: `sonare-charge`

Usado em: escopo dos pacotes npm (`@sonare-charge/api`), nomes de serviço no
`docker-compose`, nome do banco, prefixo de métricas. **Não aparece para o
usuário final.** Trocá-lo é uma refatoração mecânica e improvável.

### 2. Nome do produto: configuração, nunca literal

Fonte única em `packages/config`:

```typescript
export const brand = {
  productName: env.BRAND_PRODUCT_NAME ?? 'Borá Carregar',
  companyName: env.BRAND_COMPANY_NAME ?? 'Sonare Engenharia',
  supportEmail: env.BRAND_SUPPORT_EMAIL ?? 'suporte@example.com',
  primaryColor: env.BRAND_PRIMARY_COLOR ?? '#00C853',
};
```

Regras:

- Nenhum arquivo de UI, e-mail ou documento gerado contém a string
  `Borá Carregar` literal. Todos leem de `brand`.
- Verificado por regra de ESLint (`no-restricted-syntax` sobre o literal) e por
  um teste que faz grep no `apps/web` e `apps/api`.
- Documentação (`docs/`, `README.md`) pode usar o nome livremente — documentos
  são revisáveis por busca simples e não são código.

Assim, renomear o produto é editar variáveis de ambiente. Renomear inclusive por
estabelecimento (white-label), se um dia fizer sentido, torna-se uma evolução
natural — mas **não** será implementado no MVP (multi-tenant de marca está fora
de escopo).

## Alternativas consideradas

| Alternativa                                                         | Por que não                                                                                                                                            |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Escrever o nome direto no código e renomear depois com find/replace | Funciona mal: pega falsos positivos, esquece e-mails/PDF/OG tags, e o custo cai justamente no pior momento (quando a marca definitiva chega com prazo) |
| Framework de i18n para conter a marca                               | Sobrepeso: o MVP é pt-BR apenas                                                                                                                        |
| White-label completo por estabelecimento desde já                   | Fora do escopo do MVP                                                                                                                                  |

## Consequências

**Positivas**

- Renomear o produto custa uma variável de ambiente.
- Prepara terreno para white-label futuro sem construí-lo agora.

**Negativas**

- Um nível de indireção em textos de interface.
- Exige disciplina, garantida pela regra de lint.

**Neutras**

- O nome técnico `sonare-charge` permanece nos artefatos internos, o que é
  desejável: infraestrutura estável, marca flexível.
