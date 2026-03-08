-- RFC §19.3: Add traceId column to SessionMessage for HTTP sync path trace correlation.
-- traceId is nullable and unencrypted (it is just an opaque correlation string).
ALTER TABLE "SessionMessage" ADD COLUMN "traceId" TEXT;
