import { Prisma } from '@prisma/client';
import { db } from '@/storage/db';
import { delay } from '@/utils/delay';

export type Tx = Prisma.TransactionClient;

const symbol = Symbol();

export function afterTx(tx: Tx, callback: () => void) {
  const callbacks = (tx as any)[symbol] as (() => void)[];
  callbacks.push(callback);
}

export async function inTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  let counter = 0;
  const wrapped = async (tx: Tx) => {
    (tx as any)[symbol] = [];
    const result = await fn(tx);
    const callbacks = (tx as any)[symbol] as (() => void)[];
    return { result, callbacks };
  };
  while (true) {
    try {
      const result = await db.$transaction(wrapped, {
        isolationLevel: 'Serializable',
        timeout: 10000,
      });
      for (const callback of result.callbacks) {
        try {
          callback();
        } catch (e) {
          // Ignore errors in callbacks because they are used mostly for notifications
          console.error(e);
        }
      }
      return result.result;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2034' && counter < 3) {
          counter++;
          await delay(counter * 100);
          continue;
        }
      }
      throw e;
    }
  }
}
