ALTER TABLE "Session"
ADD COLUMN "capabilities" TEXT,
ADD COLUMN "capabilitiesVersion" INTEGER NOT NULL DEFAULT 0;
