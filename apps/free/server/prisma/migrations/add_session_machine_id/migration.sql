-- Add machineId to Session for daemon orphan-session cleanup.
-- Nullable: existing sessions have no machineId, new sessions set it on creation.
ALTER TABLE "Session" ADD COLUMN "machineId" TEXT;

CREATE INDEX "Session_accountId_machineId_status_idx" ON "Session"("accountId", "machineId", "status");
