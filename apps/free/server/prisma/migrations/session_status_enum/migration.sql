-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('active', 'offline', 'archived', 'deleted');

-- AlterTable: add status column (default 'offline' during migration, will be updated below)
ALTER TABLE "Session" ADD COLUMN "status" "SessionStatus" NOT NULL DEFAULT 'offline';

-- Migrate existing data: active=true → 'active', active=false → 'offline'
UPDATE "Session" SET "status" = 'active' WHERE "active" = true;

-- AlterTable: drop old boolean column
ALTER TABLE "Session" DROP COLUMN "active";
