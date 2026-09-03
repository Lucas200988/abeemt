-- O `transactionId` do OCPP 1.6 é um INTEIRO atribuído pelo Central System na
-- resposta ao StartTransaction. Nosso identificador de sessão é um UUID, que
-- não serve: o carregador precisa de int32.
--
-- Uma sequência do Postgres resolve com garantia de unicidade sob concorrência,
-- sem depender de "SELECT max(...) + 1", que perde a corrida entre dois
-- StartTransaction simultâneos.
--
-- Começa em 1000 para que os ids de teste não se confundam com números baixos
-- que apareçam em fixtures ou logs de firmware.
CREATE SEQUENCE IF NOT EXISTS ocpp_transaction_id_seq
  AS integer
  START WITH 1000
  INCREMENT BY 1
  NO CYCLE;

-- Localiza rapidamente a sessão de uma transação OCPP em curso, que é a
-- consulta feita a cada StopTransaction e MeterValues.
CREATE INDEX IF NOT EXISTS "charging_sessions_ocpp_transaction_id"
  ON "charging_sessions" ("ocppTransactionId")
  WHERE "ocppTransactionId" IS NOT NULL;

-- Deduplicação de mensagens OCPP recebidas (regra 11.3 e risco R-08).
-- Um carregador que retransmite o MESMO messageId não pode gerar dois
-- StartTransaction. A unicidade é garantida aqui, não na aplicação: duas
-- mensagens processadas em paralelo passariam por uma verificação em memória.
CREATE UNIQUE INDEX IF NOT EXISTS "ocpp_messages_inbound_unique"
  ON "ocpp_messages" ("chargerId", "messageId")
  WHERE "direction" = 'INBOUND';
