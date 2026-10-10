-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "terminalRefId" UUID;

-- CreateTable
CREATE TABLE "terminals" (
    "id" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "connectorId" UUID,
    "name" TEXT NOT NULL,
    "serialNumber" TEXT,
    "model" TEXT,
    "tokenHash" TEXT,
    "pairingCode" TEXT,
    "pairingExpiresAt" TIMESTAMP(3),
    "pairedAt" TIMESTAMP(3),
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSeenAt" TIMESTAMP(3),
    "appVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "terminals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "terminals_tokenHash_key" ON "terminals"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "terminals_pairingCode_key" ON "terminals"("pairingCode");

-- CreateIndex
CREATE INDEX "terminals_siteId_idx" ON "terminals"("siteId");

-- CreateIndex
CREATE INDEX "terminals_connectorId_idx" ON "terminals"("connectorId");

-- AddForeignKey
ALTER TABLE "terminals" ADD CONSTRAINT "terminals_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terminals" ADD CONSTRAINT "terminals_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "connectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_terminalRefId_fkey" FOREIGN KEY ("terminalRefId") REFERENCES "terminals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
