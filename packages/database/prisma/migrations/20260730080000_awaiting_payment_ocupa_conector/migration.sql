-- AWAITING_PAYMENT passa a ocupar o conector.
--
-- Descoberto pelo teste "o segundo pagamento no mesmo conector é recusado ANTES
-- de tocar no cartão" (test/pagamentos.e2e-spec.ts), que falhava: a segunda
-- sessão era CRIADA sem problema, porque `AWAITING_PAYMENT` não estava na lista
-- do índice, e só esbarrava na regra ao ser promovida a `PAYMENT_APPROVED` —
-- depois de o cartão do segundo motorista já ter sido consultado.
--
-- O modelo do ADR-0008 depende de a reserva do conector acontecer ANTES da
-- reserva no cartão. Com este estado incluído, duas tentativas simultâneas no
-- mesmo conector param na criação da linha, sem contato com o adquirente.
--
-- Contrapartida assumida: um pagamento que trava deixa o conector ocupado até o
-- worker expirar a sessão (SessionWorker.expirarSemPagamento), com o prazo da
-- regra 11.5.
--
-- A lista precisa continuar espelhando ACTIVE_SESSION_STATUSES em
-- packages/database/src/index.ts e packages/contracts/src/labels.ts.

DROP INDEX "charging_sessions_one_active_per_connector";

CREATE UNIQUE INDEX "charging_sessions_one_active_per_connector"
  ON "charging_sessions" ("connectorId")
  WHERE "status" IN (
    'AWAITING_PAYMENT',
    'PAYMENT_APPROVED',
    'AWAITING_CHARGER',
    'COMMAND_SENT',
    'STARTING',
    'CHARGING',
    'FINISHING'
  );
