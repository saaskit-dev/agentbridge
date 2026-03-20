import type { Prisma } from '@prisma/client';
import { db } from '@/storage/db';

type SeqClient = Pick<Prisma.TransactionClient, 'account' | 'session'>;

function resolveClient(tx?: SeqClient) {
  return tx ?? db;
}

export async function allocateUserSeq(accountId: string) {
  try {
    const user = await db.account.update({
      where: { id: accountId },
      select: { seq: true },
      data: { seq: { increment: 1 } },
    });
    return user.seq;
  } catch (error: any) {
    if (error?.code === 'P2025') {
      throw new Error(`Account not found: ${accountId}`);
    }
    throw error;
  }
}

export async function allocateSessionSeq(sessionId: string) {
  const session = await db.session.update({
    where: { id: sessionId },
    select: { seq: true },
    data: { seq: { increment: 1 } },
  });
  const seq = session.seq;
  return seq;
}

export async function allocateSessionSeqBatch(sessionId: string, count: number, tx?: SeqClient) {
  if (count <= 0) {
    return [] as number[];
  }

  const client = resolveClient(tx);
  const session = await client.session.update({
    where: { id: sessionId },
    select: { seq: true },
    data: { seq: { increment: count } },
  });

  const endSeq = session.seq;
  const startSeq = endSeq - count + 1;
  return Array.from({ length: count }, (_, index) => startSeq + index);
}
