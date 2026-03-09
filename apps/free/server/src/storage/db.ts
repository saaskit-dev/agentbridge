import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '@agentbridge/core/telemetry';

const logger = new Logger('server/storage/db');
import { PGlite } from '@electric-sql/pglite';
import { PrismaClient } from '@prisma/client';
import { PrismaPGlite } from 'pglite-prisma-adapter';

let pgliteInstance: PGlite | null = null;
let prismaClient: PrismaClient | null = null;

type WebAssemblyModuleCtor = new (bytes: Buffer) => WebAssembly.Module;

function getWebAssemblyModuleCtor(): WebAssemblyModuleCtor | null {
  const moduleCtor = (globalThis as { WebAssembly?: { Module?: unknown } }).WebAssembly?.Module;
  return typeof moduleCtor === 'function' ? (moduleCtor as WebAssemblyModuleCtor) : null;
}

function findPGliteWasm(): { wasmModule: WebAssembly.Module; fsBundle: Blob } | null {
  const wasmModuleCtor = getWebAssemblyModuleCtor();
  if (!wasmModuleCtor) {
    return null;
  }
  const searchPaths = [process.cwd(), path.dirname(process.execPath)];
  for (const dir of searchPaths) {
    const wasmPath = path.join(dir, 'pglite.wasm');
    const dataPath = path.join(dir, 'pglite.data');
    if (fs.existsSync(wasmPath) && fs.existsSync(dataPath)) {
      const wasmModule = new wasmModuleCtor(fs.readFileSync(wasmPath));
      const fsBundle = new Blob([fs.readFileSync(dataPath)]);
      return { wasmModule, fsBundle };
    }
  }
  return null;
}

function createClient(): PrismaClient {
  const pgliteDir = process.env.PGLITE_DIR;
  if (pgliteDir) {
    const wasmOpts = findPGliteWasm();
    if (wasmOpts) {
      pgliteInstance = new PGlite({ dataDir: pgliteDir, ...wasmOpts });
    } else {
      pgliteInstance = new PGlite(pgliteDir);
    }
    const adapter = new PrismaPGlite(pgliteInstance);
    prismaClient = new PrismaClient({ adapter } as any);
    return prismaClient;
  }
  prismaClient = new PrismaClient();
  return prismaClient;
}

export const db = createClient();

export function getPGlite(): PGlite | null {
  return pgliteInstance;
}

/**
 * Properly close PGLite instance to prevent data corruption
 * Must be called before process exit
 */
export async function closePGlite(): Promise<void> {
  if (pgliteInstance) {
    logger.debug('[DB] Closing PGLite instance...');
    try {
      // First disconnect Prisma
      if (prismaClient) {
        await prismaClient.$disconnect();
      }
      // Then close PGLite
      await pgliteInstance.close();
      logger.debug('[DB] PGLite closed successfully');
    } catch (error) {
      logger.error('[DB] Error closing PGLite:', error);
    }
    pgliteInstance = null;
    prismaClient = null;
  }
}
