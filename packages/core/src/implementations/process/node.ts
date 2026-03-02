/**
 * Node.js process manager implementation
 */

import { spawn, exec as nodeExec } from 'node:child_process';
import type { IProcessManager, IProcess, SpawnOptions, ExecResult } from '../../interfaces/process';
import { registerProcessManagerFactory } from '../../interfaces/process';

/**
 * Process implementation using Node.js child_process
 */
class NodeProcess implements IProcess {
  private child: ReturnType<typeof spawn>;
  private _pid: number;
  private exitPromise: Promise<{ code: number; signal?: string }>;

  constructor(
    command: string,
    args: string[],
    options?: SpawnOptions
  ) {
    this.child = spawn(command, args, {
      cwd: options?.cwd,
      env: { ...process.env, ...options?.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this._pid = this.child.pid ?? 0;

    this.exitPromise = new Promise((resolve) => {
      this.child.on('close', (code, signal) => {
        resolve({ code: code ?? 1, signal: signal ?? undefined });
      });
    });
  }

  get pid(): number {
    return this._pid;
  }

  kill(signal?: string): void {
    this.child.kill((signal ?? 'SIGTERM') as NodeJS.Signals);
  }

  async wait(): Promise<{ code: number; signal?: string }> {
    return this.exitPromise;
  }

  get stdout(): AsyncIterable<string> {
    return this.createAsyncIterable(this.child.stdout);
  }

  get stderr(): AsyncIterable<string> {
    return this.createAsyncIterable(this.child.stderr);
  }

  get stdin(): { write(data: string | Buffer): void; end?(): void } {
    return {
      write: (data: string | Buffer) => {
        this.child.stdin?.write(data);
      },
      end: () => {
        this.child.stdin?.end();
      },
    };
  }

  private async *createAsyncIterable(stream: NodeJS.ReadableStream | null): AsyncIterable<string> {
    if (!stream) return;

    const iterator = async function* (s: NodeJS.ReadableStream) {
      for await (const chunk of s) {
        yield chunk.toString();
      }
    };

    yield* iterator(stream);
  }
}

/**
 * Node.js process manager implementation
 */
class NodeProcessManager implements IProcessManager {
  spawn(command: string, args: string[], options?: SpawnOptions): IProcess {
    return new NodeProcess(command, args, options);
  }

  exec(command: string, options?: SpawnOptions): Promise<ExecResult> {
    return new Promise((resolve) => {
      nodeExec(
        command,
        {
          cwd: options?.cwd,
          env: { ...process.env, ...options?.env },
          timeout: options?.timeout,
        },
        (error, stdout, stderr) => {
          resolve({
            stdout: stdout.toString(),
            stderr: stderr.toString(),
            code: error ? (error.code ?? 1) : 0,
          });
        }
      );
    });
  }

  isAvailable(): boolean {
    return true;
  }
}

// Register factory
registerProcessManagerFactory('node', () => new NodeProcessManager());

// Export for direct use
export { NodeProcess, NodeProcessManager };
