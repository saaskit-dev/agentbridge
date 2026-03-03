/**
 * Process management
 */

/** Spawn options for creating a new process */
export interface SpawnOptions {
  /** Current working directory */
  cwd?: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** Timeout in ms */
  timeout?: number;
  /** Use PTY for interactive sessions */
  pty?: boolean;
}

/** Process interface */
export interface IProcess {
  /** Process ID */
  readonly pid: number;

  /** Kill the process */
  kill(signal?: string): void;

  /** Wait for process to exit */
  wait(): Promise<{ code: number; signal?: string }>;

  /** Standard output stream */
  readonly stdout: AsyncIterable<string>;

  /** Standard error stream */
  readonly stderr: AsyncIterable<string>;

  /** Standard input writer */
  readonly stdin: {
    write(data: string | Buffer): void;
    end?(): void;
  };
}

/** Exec result */
export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** Process manager factory type */
export type ProcessManagerFactory = () => IProcessManager;

/** Process manager interface */
export interface IProcessManager {
  /**
   * Spawn a new process.
   */
  spawn(command: string, args: string[], options?: SpawnOptions): IProcess;

  /**
   * Execute a command and wait for completion.
   */
  exec(command: string, options?: SpawnOptions): Promise<ExecResult>;

  /**
   * Check if process management is available.
   */
  isAvailable(): boolean;
}

// Factory registry
const processManagerFactories = new Map<string, ProcessManagerFactory>();

/** Register a process manager factory */
export function registerProcessManagerFactory(type: string, factory: ProcessManagerFactory): void {
  processManagerFactories.set(type, factory);
}

/** Create a process manager instance */
export function createProcessManager(type: string): IProcessManager {
  const factory = processManagerFactories.get(type);
  if (!factory) {
    throw new Error(
      `Process manager factory not found: ${type}. Available: ${[...processManagerFactories.keys()].join(', ')}`
    );
  }
  return factory();
}
