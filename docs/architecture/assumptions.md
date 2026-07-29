# Premissas e Perguntas em Aberto — Borá Carregar

Este documento registra **tudo que estamos assumindo sem confirmação**. Toda
premissa aqui é uma dívida: se estiver errada, alguma decisão de arquitetura
muda. Cada uma tem dono, impacto e como validar.

Convenção de status:

- 🔴 **Bloqueante** — trava uma fase se não for respondida.
- 🟡 **Importante** — não trava, mas gera retrabalho se estiver errada.
- 🟢 **Confortável** — baixo impacto se estiver errada.

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

> **Nenhuma dessas premissas foi testada.** Conforme instrução da FASE 0, nenhum
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
| P1 | O motorista paga **antes** de carregar, por um valor definido (pré-pago), e não com pré-autorização + captura pelo consumo real | 🔴 | Muda o fluxo financeiro inteiro: se for pré-autorização, precisamos de captura parcial e o adquirente precisa suportar isso (impacta FASE 7) |
| P2 | No MVP não há devolução automática de valor não consumido — se o motorista pagou R$ 50 e consumiu R$ 30, a regra ainda não está definida | 🔴 | Define se precisamos de estorno parcial já na FASE 5/6 |
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
| A3 | Teremos um domínio público e certificado TLS válido antes da FASE 4 | 🔴 | FASE 4 não acontece: o WEMOB em 4G precisa alcançar um endpoint público, e produção exige WSS |
| A4 | Teremos onde hospedar (VPS/cloud) o ambiente da FASE 4 | 🔴 | Idem A3 |
| A5 | Node.js 22 LTS é aceitável como runtime | 🟢 | Ajuste de versão |
| A6 | Não há exigência de residência de dados, LGPD-DPO formal ou auditoria externa no MVP | 🟡 | Requisitos adicionais de compliance |
| A7 | Não precisamos suportar OCPP 1.6 SOAP nem 2.0.1 no MVP | 🟢 | Declarado fora de escopo |

## 5. Perguntas bloqueantes — preciso das suas respostas

Estas travam decisões concretas. Numeradas para facilitar sua resposta.

### Sobre o equipamento
1. Você tem acesso ao **menu técnico** do WEMOB (senha de instalador)? Por qual meio: painel do equipamento, app WEG, cabo, web local?
2. Existe suporte WEG ativo/garantia vigente? Podemos abrir chamado para confirmar o procedimento de troca de URL OCPP?
3. Qual é o `chargePointIdentity` atual e a URL OCPP atual configurada?
4. O carregador tem **quantos conectores** e de quais tipos?
5. Além do 4G, o equipamento tem porta Ethernet ou Wi-Fi utilizável? (Rede local facilitaria muito o primeiro teste.)

### Sobre a Tupi
6. Você tem login no painel da Tupi para registrar a configuração atual?
7. Existe contrato com prazo, fidelidade ou cláusula sobre desconexão do equipamento?

### Sobre o negócio
8. O modelo é **pré-pago com valor fixo** (motorista escolhe R$ 30 e carrega até acabar) ou **pré-autorização + captura pelo consumo real**? Esta é a pergunta de maior impacto do projeto.
9. Se o motorista pagar mais do que consumir, o que acontece no MVP: sem devolução, devolução manual pelo operador, ou estorno automático?
10. Já existe preferência de adquirente/gateway (Cielo, Stone, PagSeguro, Mercado Pago, Rede, SmartPOS específico)? Se houver, a matriz da FASE 7 já nasce enviesada — melhor eu saber.

### Sobre infraestrutura
11. Onde vamos hospedar? (VPS própria, AWS, GCP, Azure, Hetzner, servidor local?) Já existe domínio disponível para o endpoint OCPP?
12. Qual a janela realista para o teste da FASE 4? Quem estará fisicamente perto do carregador? Há veículo compatível disponível?

---

## 6. Como este documento evolui

- Toda premissa validada muda de status e ganha a data e a fonte da validação.
- Toda premissa **invalidada** vira uma entrada em `risks.md` e, se mudar
  arquitetura, gera um ADR novo (nunca editamos um ADR aceito — criamos outro que
  o supersede).
- Nenhuma fase é declarada concluída com premissa 🔴 pendente que a afete.
