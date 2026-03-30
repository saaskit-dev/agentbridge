-- AlterTable: add archivedAt column for tracking when a session was archived
-- Nullable so existing archived sessions are not affected (auto-delete will use lastActiveAt as fallback)
ALTER TABLE "Session" ADD COLUMN "archivedAt" TIMESTAMP(3);
