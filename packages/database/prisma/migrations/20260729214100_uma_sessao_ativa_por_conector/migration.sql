-- Regra 11.1 do briefing: um conector não pode ter mais de uma sessão ativa.
--
-- Garantida por índice único PARCIAL, não por verificação na aplicação.
-- Duas requisições simultâneas passariam por um "SELECT ... IF NOT EXISTS";
-- não passam por um índice único. É o banco que impede a corrida.
--
-- A lista de status precisa espelhar ACTIVE_SESSION_STATUSES em
-- packages/database/src/index.ts. Se divergirem, a regra deixa de valer.

CREATE UNIQUE INDEX "charging_sessions_one_active_per_connector"
  ON "charging_sessions" ("connectorId")
  WHERE "status" IN (
    'PAYMENT_APPROVED',
    'AWAITING_CHARGER',
    'COMMAND_SENT',
    'STARTING',
    'CHARGING',
    'FINISHING'
  );

-- Regra 11.2: um pagamento não pode custear duas sessões.
-- Já coberto pelo @unique em paymentId; este índice apenas acelera a busca
-- por sessões sem pagamento associado (conciliação operacional).
CREATE INDEX "charging_sessions_without_payment"
  ON "charging_sessions" ("status")
  WHERE "paymentId" IS NULL;
