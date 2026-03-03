import { SandboxManager } from '@anthropic-ai/sandbox-runtime';
import { buildSandboxRuntimeConfig } from './config';
import type { SandboxConfig } from '@/persistence';

export async function initializeSandbox(
  sandboxConfig: SandboxConfig,
  sessionPath: string
): Promise<() => Promise<void>> {
  const runtimeConfig = buildSandboxRuntimeConfig(sandboxConfig, sessionPath);
  await SandboxManager.initialize(runtimeConfig);

  return async () => {
    await SandboxManager.reset();
  };
}

export async function wrapCommand(command: string): Promise<string> {
  return SandboxManager.wrapWithSandbox(command);
}

export async function wrapForMcpTransport(
  command: string,
  args: string[]
): Promise<{ command: 'sh'; args: ['-c', string] }> {
  const wrappedCommand = await wrapCommand(`${command} ${args.join(' ')}`.trim());
  return {
    command: 'sh',
    args: ['-c', wrappedCommand],
  };
}
