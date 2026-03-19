-- Drop session tag: daemon now uses client-generated UUIDs as session ID directly.
-- The tag field was a separate lookup key for get-or-create; no longer needed.

-- Drop the composite unique index first
DROP INDEX IF EXISTS "Session_accountId_tag_key";

-- Drop the tag column
ALTER TABLE "Session" DROP COLUMN IF EXISTS "tag";
