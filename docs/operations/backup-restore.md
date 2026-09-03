# Backup e restauração

**Backup que nunca foi restaurado não é backup — é esperança.** Por isso este
documento tem duas metades com o mesmo peso: gerar, e provar que volta.

O primeiro ensaio completo (gerar → restaurar num banco limpo → conferir
contagens) foi executado em 2026-07-31, no ambiente de desenvolvimento. O
mesmo ensaio na máquina do piloto é **item bloqueante** do
[checklist do piloto](pilot-checklist.md).

---

## 1. Gerar

```
pnpm backup
```

- Sai em `backups/bora-<data>.dump`, formato `custom` do PostgreSQL
  (comprimido; restaurável por tabela).
- Retenção: os 7 mais recentes ficam; `pnpm backup -- --keep 14` muda.
- O script recusa dump suspeito de vazio (menos de 1 KB).
- `backups/` está no `.gitignore` — backup não vai para o repositório.

**No piloto:** agende diariamente (Agendador de Tarefas do Windows ou cron) e
**copie o arquivo para fora da máquina** — backup no mesmo disco que o banco
morre junto com ele. Um drive na nuvem sincronizando a pasta `backups/` já
resolve o piloto.

## 2. Restaurar

> Pré-requisito: `pg_restore` e `psql` no PATH (vêm com o PostgreSQL).

### 2.1 Ensaio (obrigatório antes do piloto, recomendado mensal)

Restaura numa cópia de lado, sem tocar no banco de verdade:

```
psql -h localhost -U bora -d postgres -c "CREATE DATABASE bora_ensaio;"
pg_restore --no-owner -h localhost -U bora -d bora_ensaio backups/<arquivo>.dump
psql -h localhost -U bora -d bora_ensaio -c "SELECT count(*) FROM charging_sessions;"
psql -h localhost -U bora -d postgres -c "DROP DATABASE bora_ensaio;"
```

A contagem deve bater com a do banco original na hora do backup. Anote a data
do ensaio no checklist.

### 2.2 Restauração de verdade (incidente)

1. **Pare a API** antes de tudo — restaurar com o sistema escrevendo é
   corromper de novo.
2. Preserve o que restou: renomeie o banco ferido em vez de apagar —
   `ALTER DATABASE bora_carregar RENAME TO bora_carregar_ferido;`
3. Crie o banco limpo e restaure:
   ```
   psql -h localhost -U bora -d postgres -c "CREATE DATABASE bora_carregar;"
   pg_restore --no-owner -h localhost -U bora -d bora_carregar backups/<mais-recente>.dump
   ```
4. Suba a API e abra a Visão Geral: **os alertas dizem o que ficou pendente.**
5. **Janela de perda:** tudo entre o backup e o incidente não existe mais no
   banco. Sessões dessa janela têm rastro no adquirente (extrato da Rede, por
   `tid`) — a conciliação manual dessa janela é trabalho do administrador.
6. Só apague `bora_carregar_ferido` depois da conciliação.

## 3. O que o backup NÃO cobre

- O `.env` (credenciais) — guarde uma cópia dele em local seguro, fora da
  máquina. Sem ele, restaurar o banco não sobe o sistema.
- Os logs da API — são diagnóstico, não dado comercial; perdê-los dói menos.
