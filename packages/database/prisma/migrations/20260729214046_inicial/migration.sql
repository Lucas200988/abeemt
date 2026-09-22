-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'ORG_ADMIN', 'OPERATOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "EntityStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('ONLINE', 'OFFLINE', 'NEVER_CONNECTED');

-- CreateEnum
CREATE TYPE "OperationalStatus" AS ENUM ('AVAILABLE', 'BLOCKED', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "ConnectorStatus" AS ENUM ('AVAILABLE', 'PREPARING', 'CHARGING', 'SUSPENDED_EV', 'SUSPENDED_EVSE', 'FINISHING', 'RESERVED', 'UNAVAILABLE', 'FAULTED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CREDIT_CARD', 'DEBIT_CARD', 'PIX', 'MANUAL');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'AUTHORIZED', 'CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'VOIDED', 'DECLINED', 'EXPIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('AWAITING_PAYMENT', 'PAYMENT_APPROVED', 'AWAITING_CHARGER', 'COMMAND_SENT', 'STARTING', 'CHARGING', 'FINISHING', 'COMPLETED', 'DECLINED', 'CANCELLED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "StopReason" AS ENUM ('REMOTE_STOP', 'LOCAL_STOP', 'EV_DISCONNECTED', 'EMERGENCY_STOP', 'POWER_LOSS', 'CEILING_REACHED', 'DE_AUTHORIZED', 'CHARGER_FAULT', 'COMMUNICATION_LOST', 'OTHER');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "organizationId" UUID,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "preAuthCeilingCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sites" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "taxId" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Cuiaba',
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "preAuthCeilingCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chargers" (
    "id" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "chargePointIdentity" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "manufacturer" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "firmwareVersion" TEXT,
    "protocolVersion" TEXT NOT NULL DEFAULT 'ocpp1.6',
    "address" TEXT,
    "connectionStatus" "ConnectionStatus" NOT NULL DEFAULT 'NEVER_CONNECTED',
    "operationalStatus" "OperationalStatus" NOT NULL DEFAULT 'AVAILABLE',
    "lastSeenAt" TIMESTAMP(3),
    "lastBootAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "credentialsHash" TEXT,
    "preAuthCeilingCents" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chargers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connectors" (
    "id" UUID NOT NULL,
    "chargerId" UUID NOT NULL,
    "connectorNumber" INTEGER NOT NULL,
    "connectorType" TEXT,
    "ratedPowerKw" DECIMAL(8,2),
    "status" "ConnectorStatus" NOT NULL DEFAULT 'AVAILABLE',
    "errorCode" TEXT,
    "lastStatusAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tariffs" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "siteId" UUID,
    "name" TEXT NOT NULL,
    "pricePerKwhCents" INTEGER NOT NULL,
    "connectionFeeCents" INTEGER NOT NULL DEFAULT 0,
    "pricePerMinuteCents" INTEGER NOT NULL DEFAULT 0,
    "minimumAmountCents" INTEGER NOT NULL DEFAULT 0,
    "maximumAmountCents" INTEGER,
    "idleFeePerMinuteCents" INTEGER NOT NULL DEFAULT 0,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tariffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "providerPaymentId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "terminalId" TEXT,
    "amountAuthorizedCents" INTEGER NOT NULL,
    "amountCapturedCents" INTEGER NOT NULL DEFAULT 0,
    "amountRefundedCents" INTEGER NOT NULL DEFAULT 0,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "authorizationCode" TEXT,
    "nsu" TEXT,
    "cardBrand" TEXT,
    "cardLastFour" TEXT,
    "pixEndToEndId" TEXT,
    "authorizedAt" TIMESTAMP(3),
    "capturedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "rawMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charging_sessions" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "chargerId" UUID NOT NULL,
    "connectorId" UUID NOT NULL,
    "paymentId" UUID,
    "ocppTransactionId" INTEGER,
    "idTag" TEXT,
    "status" "SessionStatus" NOT NULL DEFAULT 'AWAITING_PAYMENT',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "authorizedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),
    "meterStartWh" INTEGER,
    "meterStopWh" INTEGER,
    "energyWh" INTEGER,
    "durationSeconds" INTEGER,
    "tariffId" UUID,
    "tariffSnapshot" JSONB,
    "estimatedAmountCents" INTEGER,
    "finalAmountCents" INTEGER,
    "ceilingAmountCents" INTEGER,
    "stopReason" "StopReason",
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "charging_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meter_values" (
    "id" UUID NOT NULL,
    "sessionId" UUID,
    "chargerId" UUID NOT NULL,
    "connectorId" UUID,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "measurand" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "unit" TEXT,
    "phase" TEXT,
    "context" TEXT,
    "location" TEXT,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meter_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ocpp_messages" (
    "id" UUID NOT NULL,
    "chargerId" UUID,
    "direction" "MessageDirection" NOT NULL,
    "messageType" INTEGER NOT NULL,
    "messageId" TEXT NOT NULL,
    "action" TEXT,
    "payload" JSONB,
    "responsePayload" JSONB,
    "errorCode" TEXT,
    "errorDescription" TEXT,
    "correlationId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "processingDurationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ocpp_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "organizationId" UUID,
    "userId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "previousValue" JSONB,
    "newValue" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_organizationId_idx" ON "users"("organizationId");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "refresh_tokens_expiresAt_idx" ON "refresh_tokens"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "sites_organizationId_idx" ON "sites"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "sites_organizationId_name_key" ON "sites"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "chargers_chargePointIdentity_key" ON "chargers"("chargePointIdentity");

-- CreateIndex
CREATE INDEX "chargers_siteId_idx" ON "chargers"("siteId");

-- CreateIndex
CREATE INDEX "chargers_connectionStatus_idx" ON "chargers"("connectionStatus");

-- CreateIndex
CREATE INDEX "connectors_chargerId_idx" ON "connectors"("chargerId");

-- CreateIndex
CREATE UNIQUE INDEX "connectors_chargerId_connectorNumber_key" ON "connectors"("chargerId", "connectorNumber");

-- CreateIndex
CREATE INDEX "tariffs_organizationId_idx" ON "tariffs"("organizationId");

-- CreateIndex
CREATE INDEX "tariffs_siteId_idx" ON "tariffs"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotencyKey_key" ON "payments"("idempotencyKey");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE INDEX "payments_providerPaymentId_idx" ON "payments"("providerPaymentId");

-- CreateIndex
CREATE INDEX "payments_expiresAt_idx" ON "payments"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "charging_sessions_paymentId_key" ON "charging_sessions"("paymentId");

-- CreateIndex
CREATE INDEX "charging_sessions_organizationId_idx" ON "charging_sessions"("organizationId");

-- CreateIndex
CREATE INDEX "charging_sessions_chargerId_idx" ON "charging_sessions"("chargerId");

-- CreateIndex
CREATE INDEX "charging_sessions_connectorId_idx" ON "charging_sessions"("connectorId");

-- CreateIndex
CREATE INDEX "charging_sessions_status_idx" ON "charging_sessions"("status");

-- CreateIndex
CREATE INDEX "charging_sessions_startedAt_idx" ON "charging_sessions"("startedAt");

-- CreateIndex
CREATE INDEX "meter_values_sessionId_idx" ON "meter_values"("sessionId");

-- CreateIndex
CREATE INDEX "meter_values_chargerId_timestamp_idx" ON "meter_values"("chargerId", "timestamp");

-- CreateIndex
CREATE INDEX "ocpp_messages_chargerId_receivedAt_idx" ON "ocpp_messages"("chargerId", "receivedAt");

-- CreateIndex
CREATE INDEX "ocpp_messages_correlationId_idx" ON "ocpp_messages"("correlationId");

-- CreateIndex
CREATE INDEX "ocpp_messages_messageId_idx" ON "ocpp_messages"("messageId");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_createdAt_idx" ON "audit_logs"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chargers" ADD CONSTRAINT "chargers_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connectors" ADD CONSTRAINT "connectors_chargerId_fkey" FOREIGN KEY ("chargerId") REFERENCES "chargers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tariffs" ADD CONSTRAINT "tariffs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tariffs" ADD CONSTRAINT "tariffs_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charging_sessions" ADD CONSTRAINT "charging_sessions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charging_sessions" ADD CONSTRAINT "charging_sessions_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charging_sessions" ADD CONSTRAINT "charging_sessions_chargerId_fkey" FOREIGN KEY ("chargerId") REFERENCES "chargers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charging_sessions" ADD CONSTRAINT "charging_sessions_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charging_sessions" ADD CONSTRAINT "charging_sessions_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charging_sessions" ADD CONSTRAINT "charging_sessions_tariffId_fkey" FOREIGN KEY ("tariffId") REFERENCES "tariffs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meter_values" ADD CONSTRAINT "meter_values_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "charging_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meter_values" ADD CONSTRAINT "meter_values_chargerId_fkey" FOREIGN KEY ("chargerId") REFERENCES "chargers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meter_values" ADD CONSTRAINT "meter_values_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "connectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocpp_messages" ADD CONSTRAINT "ocpp_messages_chargerId_fkey" FOREIGN KEY ("chargerId") REFERENCES "chargers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
