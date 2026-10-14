# ADR-0009 — Topologia de domínios e endpoints

- **Status:** Aceito
- **Data:** 2026-07-29
- **Fase:** 0 (provisionamento na FASE 2/4)
- **Origem:** definição do domínio `sonare.com.br` pelo cliente em 2026-07-29

## Contexto

Você definiu que o domínio do projeto será `sonare.com.br` (mencionado como
`www.sonare.com.br`). Isso destrava as premissas A3/A4 e a FASE 4.

Há um detalhe importante: `www.sonare.com.br` provavelmente já hospeda o **site
institucional da Sonare Engenharia**. Usar esse mesmo host para o endpoint OCPP
misturaria duas coisas com requisitos muito diferentes:

|                      | Site institucional       | Endpoint OCPP                                         |
| -------------------- | ------------------------ | ----------------------------------------------------- |
| Disponibilidade      | importante               | **crítica** — carregador desconecta se cair           |
| Tipo de tráfego      | HTTP, requisições curtas | WebSocket persistente, horas de duração               |
| Deploy               | ocasional                | frequente durante o desenvolvimento                   |
| Superfície de ataque | marketing                | **aciona equipamento elétrico**                       |
| CDN/proxy            | desejável                | proxies de CDN frequentemente quebram WebSocket longo |

Um deploy do site derrubando a conexão de um carregador no meio de uma recarga
paga é um modo de falha que não queremos ter inventado.

## Decisão

Usar **subdomínios dedicados**, mantendo `www.sonare.com.br` intocado.

| Subdomínio             | Uso                                      | Protocolo      | Exposição                                                                     |
| ---------------------- | ---------------------------------------- | -------------- | ----------------------------------------------------------------------------- |
| `ocpp.sonare.com.br`   | Endpoint WebSocket dos carregadores      | `wss://` (443) | Pública, mas restrita por autenticação e — quando possível — por IP de origem |
| `api.sonare.com.br`    | API REST (painel, webhooks de pagamento) | `https://`     | Pública                                                                       |
| `painel.sonare.com.br` | Painel administrativo (Next.js)          | `https://`     | Pública, atrás de login                                                       |
| `www.sonare.com.br`    | Site institucional existente             | —              | **Não tocamos**                                                               |

URL final do carregador:

```
wss://ocpp.sonare.com.br/ocpp/{chargePointIdentity}
```

### Regras de configuração

1. **Sem CDN/proxy com cache na frente do `ocpp.`** Nginx próprio, com
   `proxy_read_timeout` alto o suficiente para conexões de horas e upgrade de
   WebSocket explicitamente configurado. Cloudflare e similares podem funcionar,
   mas adicionam um intermediário que pode encerrar conexões longas — não é o
   lugar para descobrir isso durante um teste com equipamento real.
2. **TLS via Let's Encrypt** com renovação automática. Atenção: renovação que
   recarrega o Nginx não pode derrubar conexões WebSocket — usar `reload`, não
   `restart`, e validar esse comportamento antes da FASE 4.
3. **Certificado com cadeia completa.** Firmwares embarcados costumam ter
   armazenamento de CAs raiz limitado e desatualizado; cadeia incompleta é uma
   causa clássica de "não conecta e não diz por quê".
4. **Separação de ambientes:** `ocpp-staging.sonare.com.br`,
   `api-staging.sonare.com.br` para testes com o simulador antes de apontar o
   equipamento real. O simulador deve conectar pela internet no endpoint de
   staging antes de qualquer teste com o WEMOB.
5. `www.sonare.com.br` não recebe nenhuma alteração de DNS, servidor ou
   certificado por conta deste projeto.

### Estratégia de rede da FASE 4, revisada (o WEMOB tem Ethernet)

Com a confirmação de que o equipamento tem porta Ethernet, a FASE 4 se divide em
duas etapas, e a primeira é muito mais segura:

**FASE 4a — Teste em rede local (sem internet, sem domínio, sem TLS público)**

```
WEMOB ──(cabo Ethernet)──► switch/roteador do local ──► notebook rodando a API
                                    ws://192.168.x.x:3001/ocpp/{identity}
```

Vantagens: nenhuma dependência de DNS, certificado, VPS, firewall ou qualidade
do 4G. Se o equipamento não conectar, o problema está no OCPP — não em cinco
camadas de infraestrutura ao mesmo tempo. Rollback é trocar a URL de volta.

Ressalva registrada como premissa E14: alguns firmwares recusam `ws://` sem TLS.
Se for o caso do WEMOB, a 4a precisa de TLS local com CA própria instalada no
equipamento (nem sempre possível) — ou é pulada em favor da 4b.

**FASE 4b — Teste com infraestrutura pública**

```
WEMOB ──(4G ou Ethernet)──► internet ──► ocpp.sonare.com.br ──► Nginx ──► API
                                          wss://, TLS válido
```

Só depois que a 4a comprovar o diálogo OCPP com o equipamento real.

Essa divisão reduz o risco R-18 (dependência de infraestrutura pública) de
**crítico para médio**: a primeira conexão com o equipamento real deixa de
depender de VPS, DNS e certificado estarem prontos e corretos.

## Alternativas consideradas

| Alternativa                                                                    | Por que não                                                                                                                                                                                                |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Usar `www.sonare.com.br/ocpp`                                                  | Acopla a infra crítica ao site institucional; deploy do site derruba carregador                                                                                                                            |
| Domínio novo e separado (ex.: `boracarregar.com.br`)                           | Faz sentido quando a marca for definitiva. Hoje o nome é provisório (ADR-0007) — registrar domínio para um nome que pode mudar é desperdício                                                               |
| Um único subdomínio com paths (`charge.sonare.com.br/ocpp`, `/api`, `/painel`) | Funciona e é mais barato de configurar. Recusado porque o endpoint OCPP tem requisitos de disponibilidade e deploy diferentes dos demais — separar permite tratá-lo com mais cuidado sem penalizar o resto |
| Ir direto para a 4b, ignorando a rede local                                    | Desperdiça a maior redução de risco disponível no projeto                                                                                                                                                  |

## Consequências

**Positivas**

- Site institucional isolado e protegido do projeto.
- Primeira conexão com o equipamento real sem depender de infraestrutura pública.
- Endpoint OCPP pode ter política de deploy própria (janela, drain de conexões).

**Negativas**

- Três subdomínios para provisionar e três certificados para manter (mitigável
  com certificado curinga `*.sonare.com.br`, se o DNS permitir validação DNS-01).
- Exige controle do DNS de `sonare.com.br` — **ainda não confirmado**
  (premissa A8, pergunta 14).

**Neutras**

- Em desenvolvimento local, tudo continua em `localhost` com portas distintas.
