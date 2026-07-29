# Premissas e Perguntas em Aberto — Borá Carregar

Este documento registra **tudo que estamos assumindo sem confirmação**. Toda
premissa aqui é uma dívida: se estiver errada, alguma decisão de arquitetura
muda. Cada uma tem dono, impacto e como validar.

Convenção de status:

- 🔴 **Bloqueante** — trava uma fase se não for respondida.
- 🟡 **Importante** — não trava, mas gera retrabalho se estiver errada.
- 🟢 **Confortável** — baixo impacto se estiver errada.
- ✅ **Confirmado** — respondido por você; deixou de ser premissa.

### Histórico de confirmações

**2026-07-29 — respostas recebidas:**

| Tema | Resposta | Efeito |
| --- | --- | --- |
| Domínio | `sonare.com.br` | Destrava A3/A4; ver [ADR-0009](adr/0009-topologia-de-dominios.md) |
| Rede do WEMOB | Tem **Ethernet** | Destrava a FASE 4 em duas etapas (4a local, 4b pública); reduz o risco R-18 |
| Modelo de pagamento | **Pré-autorização + captura pelo consumo real** | Resolve P1; ver [ADR-0008](adr/0008-pre-autorizacao-e-captura.md); abre novas perguntas sobre Pix e cartão de débito |

---

## 1. Premissas sobre o equipamento (WEG WEMOB Station)

| # | Premissa | Status | Impacto se falsa | Como validar |
| --- | --- | --- | --- | --- |
| E1 | O WEMOB permite alterar a URL do servidor OCPP via menu técnico, app ou ferramenta WEG, sem intervenção da Tupi | 🔴 | FASE 4 inviável no formato planejado; seria preciso negociar com Tupi/WEG ou usar outro equipamento | Consultar manual WEG + acesso ao menu de configuração |
| E2 | A alteração da URL é **reversível** e o retorno à Tupi é apenas reconfigurar a URL original | 🔴 | Risco de deixar o carregador inoperante em produção | Documentar procedimento antes de qualquer alteração (ver `tupi-rollback-plan.md`) |
| E3 | O equipamento implementa OCPP 1.6J (JSON sobre WebSocket), e não OCPP 1.6 SOAP | 🟡 | Todo o transporte muda; SOAP exige implementação diferente | Confirmar em ficha técnica/menu do equipamento |
| E4 | Autenticação OCPP é `Basic Auth` no handshake WebSocket ou nenhuma autenticação (apenas identity na URL) | 🟡 | Se exigir mTLS/certificado, a FASE 4 ganha etapa de PKI | Verificar menu do carregador + doc WEG |
| E5 | O `chargePointIdentity` é configurável ou pelo menos legível | 🟡 | Precisamos aceitar a identity que o equipamento usar hoje | Ler no menu técnico |
| E6 | O WEMOB de 30 kW tem 1 ou 2 conectores DC; o número exato ainda não foi confirmado | 🟡 | Afeta seed, cadastro e testes de conector ocupado | Inspeção física + placa de identificação |
| E7 | O carregador envia `MeterValues` com `Energy.Active.Import.Register` (acumulado) — medida que permite `energia = final − inicial` | 🟡 | Se só enviar potência instantânea, precisaremos integrar no tempo (menos preciso, exige ADR novo) | Capturar mensagens reais na FASE 4 |
| E8 | O firmware aceita `RemoteStartTransaction` sem exigir `idTag` previamente autorizado por lista local | 🟡 | Precisaríamos gerenciar `LocalAuthList` | Teste controlado na FASE 4 |
| E9 | A conectividade 4G tem qualidade suficiente para manter WebSocket estável | 🟡 | Mais reconexões; a arquitetura já assume instabilidade, mas a UX de operação piora | Observar heartbeats na FASE 4 |
| E10 | Não há contrato/garantia que seja violado ao apontar o equipamento para outro servidor OCPP | 🔴 | Risco jurídico/comercial, não técnico | Verificar contrato Tupi e garantia WEG |
| E11 | **O equipamento possui porta Ethernet** | ✅ | Confirmado por você em 2026-07-29 | — |
| E12 | Existe **cabeamento de rede efetivamente puxado até o carregador** (ou é viável puxar no dia do teste) | 🔴 | Sem cabo, a FASE 4a (teste em rede local) não acontece e voltamos a depender de 4G + domínio público na primeira conexão | Inspeção física no local |
| E13 | A interface de rede é selecionável no menu (Ethernet **ou** 4G), e trocar para Ethernet é reversível | 🟡 | Se a troca de interface for irreversível ou instável, o ganho de segurança da 4a desaparece | Menu técnico / manual WEG |
| E14 | O equipamento aceita URL OCPP com IP privado e `ws://` (sem TLS) em rede local | 🟡 | Alguns firmwares exigem `wss://` e recusam host sem certificado válido. Se for o caso, a FASE 4a precisa de TLS local com CA própria — ou é substituída pela 4b direto | Teste na janela; ou consultar suporte WEG antes |

> **Nenhuma dessas premissas foi testada no equipamento.** Conforme instrução da FASE 0, nenhum
> comando, conexão ou alteração foi executada contra o equipamento real.

## 2. Premissas sobre a Tupi (plataforma atual)

| # | Premissa | Status | Impacto se falsa | Como validar |
| --- | --- | --- | --- | --- |
| T1 | O carregador só consegue estar conectado a **um** servidor OCPP por vez | 🟢 (é assim no OCPP 1.6) | Se fosse possível manter dois, os testes seriam bem mais seguros | Padrão OCPP 1.6 — uma conexão WS por charge point |
| T2 | Retirar o equipamento da Tupi temporariamente não gera multa, bloqueio de conta ou perda de dados históricos | 🟡 | Custo comercial inesperado | Ler contrato / falar com a Tupi |
| T3 | Temos acesso ao painel Tupi para registrar a configuração atual antes de mudar | 🔴 | Sem isso, o rollback fica sem referência | Login no painel Tupi e capturas de tela |
| T4 | O histórico de sessões anteriores permanece na Tupi mesmo com o equipamento desconectado | 🟢 | Perda de histórico comercial | Confirmar com a Tupi |

## 3. Premissas de produto e negócio

| # | Premissa | Status | Consequência |
| --- | --- | --- | --- |
| P1 | ~~O motorista paga antes de carregar, por um valor definido (pré-pago)~~ → **RESOLVIDO: pré-autorização + captura pelo consumo real** | ✅ | Confirmado por você em 2026-07-29. Formalizado no [ADR-0008](adr/0008-pre-autorizacao-e-captura.md). Consequências: `capturePayment` deixa de ser opcional; o teto de pré-autorização vira limite de sessão com parada automática; a matriz da FASE 7 passa a ter pré-autorização como critério eliminatório |
| P2 | ~~Devolução de valor não consumido~~ → **RESOLVIDO para cartão**: capturamos só o consumido; o saldo é liberado pela captura parcial | ✅ (cartão) 🔴 (Pix) | Para cartão não existe "devolução" — nunca cobramos a mais. **Para Pix o problema continua aberto**: Pix não tem pré-autorização. Ver P8 |
| P8 | **Pix não suporta pré-autorização.** O modelo escolhido não se aplica a Pix sem uma regra separada | 🔴 | Decisão necessária antes da FASE 7: (a) Pix só como pré-pago com valor fixo + devolução parcial via API de devolução; (b) Pix fora do MVP, só cartão; (c) Pix com valor fixo sem devolução. Cada opção muda a UX e a matriz de adquirentes |
| P9 | Cartão de **débito** frequentemente não suporta pré-autorização no Brasil | 🟡 | Se boa parte dos motoristas usa débito, parte do público fica sem caminho de pagamento. Vira critério da matriz da FASE 7 |
| P10 | Existe um **teto padrão de pré-autorização** por sessão (ex.: R$ 100) e o motorista pode ou não escolhê-lo | 🟡 | Define a UX do terminal (FASE 8) e o valor de `maximumAmountCents` da sessão |
| P3 | O estabelecimento é o responsável comercial; não há split financeiro real no MVP | 🟡 | Fora do escopo declarado; entra depois |
| P4 | Não há emissão de nota fiscal no MVP | 🟢 | Declarado fora de escopo |
| P5 | O idioma do painel é exclusivamente pt-BR; não há i18n no MVP | 🟢 | Strings podem ficar inline sem framework de tradução |
| P6 | O operador do painel é uma pessoa treinada (não é autoatendimento) | 🟢 | Permite densidade de informação técnica na área de diagnóstico |
| P7 | O volume inicial é de **1 carregador** e cresce para dezenas, não milhares | 🟡 | Justifica a ausência de Redis/fila distribuída (ADR-0003). Se a meta for milhares de carregadores no ano 1, a escala do gateway OCPP precisa ser reavaliada |

## 4. Premissas técnicas

| # | Premissa | Status | Consequência se falsa |
| --- | --- | --- | --- |
| A1 | Um único processo Node aguenta o volume de conexões WebSocket do MVP | 🟢 | Extração do gateway OCPP para serviço próprio (caminho já documentado no ADR-0002) |
| A2 | PostgreSQL com `SKIP LOCKED` cobre fila, outbox e retries no MVP | 🟡 | Introdução de Redis/BullMQ conforme gatilhos do ADR-0003 |
| A3 | ~~Teremos um domínio público~~ → **RESOLVIDO: `sonare.com.br`** | ✅ | Confirmado por você em 2026-07-29. Topologia de subdomínios no [ADR-0009](adr/0009-topologia-de-dominios.md) |
| A4 | Teremos onde hospedar (VPS/cloud) o ambiente da FASE 4b | 🔴 | Ainda aberto — o domínio existe, o servidor não. Ver pergunta 13 |
| A8 | Temos **controle do DNS** de `sonare.com.br` para criar subdomínios | 🔴 | Sem isso, não há endpoint OCPP público nem certificado TLS. Ver pergunta 14 |
| A9 | O site institucional que roda hoje em `www.sonare.com.br` **não** será afetado | 🟢 | Por isso a decisão de usar subdomínios dedicados e nunca o `www` (ADR-0009) |
| A5 | Node.js 22 LTS é aceitável como runtime | 🟢 | Ajuste de versão |
| A6 | Não há exigência de residência de dados, LGPD-DPO formal ou auditoria externa no MVP | 🟡 | Requisitos adicionais de compliance |
| A7 | Não precisamos suportar OCPP 1.6 SOAP nem 2.0.1 no MVP | 🟢 | Declarado fora de escopo |

## 5. Perguntas — respondidas e em aberto

### ✅ Respondidas em 2026-07-29

| # | Pergunta | Resposta |
| --- | --- | --- |
| 5 | O equipamento tem Ethernet ou Wi-Fi além do 4G? | **Tem Ethernet** |
| 8 | Pré-pago com valor fixo ou pré-autorização + captura? | **Pré-autorização + captura pelo consumo real** |
| 9 | O que acontece se pagar mais do que consumir? | Não se aplica a cartão — capturamos só o consumido |
| 11 (parcial) | Domínio para o endpoint OCPP | **`sonare.com.br`** |

### 🔴 Ainda em aberto — bloqueantes

**Sobre o equipamento**
1. Você tem acesso ao **menu técnico** do WEMOB (senha de instalador)? Por qual meio: painel do equipamento, app WEG, cabo, web local?
2. Existe suporte WEG ativo/garantia vigente? Podemos abrir chamado para confirmar o procedimento de troca de URL OCPP?
3. Qual é o `chargePointIdentity` atual e a URL OCPP atual configurada?
4. O carregador tem **quantos conectores** e de quais tipos?
15. **(nova)** Já existe cabo de rede puxado até o carregador, ou a porta Ethernet está sem uso? Se não houver, é viável puxar um cabo no dia do teste? *(premissa E12 — sem isso a FASE 4a não existe)*
16. **(nova)** O menu do WEMOB permite escolher a interface de rede (Ethernet/4G) e voltar atrás? *(premissa E13)*

**Sobre a Tupi**
6. Você tem login no painel da Tupi para registrar a configuração atual?
7. Existe contrato com prazo, fidelidade ou cláusula sobre desconexão do equipamento?

**Sobre o negócio — decorrentes da escolha de pré-autorização**
10. Já existe preferência de adquirente/gateway (Cielo, Stone, PagSeguro, Mercado Pago, Rede, SmartPOS específico)? Se houver, a matriz da FASE 7 já nasce enviesada — melhor eu saber.
17. **(nova)** **Pix não tem pré-autorização.** Como tratamos? (a) Pix como pré-pago com valor fixo e devolução parcial do não consumido; (b) Pix fora do MVP, só cartão; (c) Pix com valor fixo e sem devolução. *(premissa P8 — muda a UX e a matriz da FASE 7)*
18. **(nova)** Qual o **teto padrão de pré-autorização** por sessão? (ex.: R$ 100.) O motorista escolhe o valor ou é fixo pelo estabelecimento? *(premissa P10)*
19. **(nova)** Quando a sessão atinge o teto pré-autorizado, o comportamento é **parar automaticamente** a recarga? Confirmo que sim como padrão. *(regra nova — ver ADR-0008 §4)*

**Sobre infraestrutura**
13. Onde vamos hospedar? (VPS própria, AWS, GCP, Azure, Hetzner, servidor local?) *(premissa A4)*
14. **(nova)** Temos **controle do DNS** de `sonare.com.br` para criar subdomínios como `ocpp.sonare.com.br`? Quem administra? *(premissa A8)*
12. Qual a janela realista para o teste da FASE 4? Quem estará fisicamente perto do carregador? Há veículo compatível disponível?

---

## 6. Como este documento evolui

- Toda premissa validada muda de status e ganha a data e a fonte da validação.
- Toda premissa **invalidada** vira uma entrada em `risks.md` e, se mudar
  arquitetura, gera um ADR novo (nunca editamos um ADR aceito — criamos outro que
  o supersede).
- Nenhuma fase é declarada concluída com premissa 🔴 pendente que a afete.
