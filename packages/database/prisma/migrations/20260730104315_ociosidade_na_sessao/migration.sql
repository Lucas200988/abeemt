-- AlterTable
ALTER TABLE "charging_sessions" ADD COLUMN     "idleSeconds" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastMeterAt" TIMESTAMP(3);
