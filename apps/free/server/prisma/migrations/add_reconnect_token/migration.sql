-- CreateTable
CREATE TABLE "ReconnectToken" (
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReconnectToken_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "ReconnectToken_userId_idx" ON "ReconnectToken"("userId");
