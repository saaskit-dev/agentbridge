/**
 * InputHandler — reads stdin and forwards text to the daemon via IPC.
 *
 * Three modes:
 *   - line mode (default): collects input until newline, sends full line as send_input
 *   - raw (PTY) mode: forwards raw bytes as base64-encoded pty_data messages so the
 *     daemon can pipe them directly into the agent's stdin (Claude local mode).
 *     In raw mode stdin.setRawMode(true) is used; Ctrl+C is detected by byte value
 *     (0x03) rather than SIGINT so arrow keys, function keys, Ctrl combos all pass
 *     through intact. A pty_resize message is also sent on terminal resize.
 *   - idle mode: stdin is in raw mode but keystrokes trigger switch_mode IPC instead
 *     of being forwarded. Used when daemon switches Claude from local PTY to remote SDK.
 *     Any keypress (except Ctrl+C) sends switch_mode to request going back to local.
 */

import readline from 'node:readline';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import type { IPCClient } from '@/daemon/ipc/IPCClient';

const logger = new Logger('client/InputHandler');

export interface InputHandlerOptions {
  /**
   * When true, stdin is put in raw mode and keystrokes are forwarded as
   * pty_data IPC messages rather than collected per line.
   * Only activate when process.stdin.isTTY is true.
   */
  isPtyMode?: boolean;
}

type ActiveMode = 'pty' | 'idle' | 'line' | 'none';

export class InputHandler {
  private rl?: readline.Interface;
  private stopped = false;
  private activeMode: ActiveMode = 'none';

  /** Bound handler for stdin 'data' events — stored for clean removal on mode switch. */
  private stdinDataHandler: ((chunk: Buffer) => void) | null = null;
  /** Bound handler for stdout 'resize' events. */
  private resizeHandler: (() => void) | null = null;

  constructor(
    private readonly ipcClient: IPCClient,
    private readonly sessionId: string,
    private readonly opts: InputHandlerOptions = {}
  ) {}

  /** Start reading stdin and forwarding to daemon. */
  start(): void {
    if (this.opts.isPtyMode && process.stdin.isTTY) {
      this.startPtyMode();
    } else {
      this.startLineMode();
    }
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    logger.debug('[InputHandler] stopped', { sessionId: this.sessionId });
    this.teardownCurrentMode();
  }

  // ---------------------------------------------------------------------------
  // Dynamic mode switching (PTY ↔ idle)
  // ---------------------------------------------------------------------------

  /**
   * Switch to idle (spectator) mode. Called when daemon switches Claude to remote SDK.
   * Stdin stays in raw mode but keystrokes trigger switch_mode instead of pty_data.
   */
  switchToIdleMode(): void {
    if (this.stopped || !process.stdin.isTTY) return;
    if (this.activeMode === 'idle') return;
    logger.debug('[InputHandler] switching to idle mode');
    this.teardownCurrentMode();
    this.startIdleMode();
  }

  /**
   * Disable stdin handling entirely. Called when an Ink UI takes over the terminal
   * (e.g. RemoteModeDisplay) so that InputHandler does not conflict with Ink's useInput.
   */
  switchToDisabledMode(): void {
    if (this.stopped) return;
    if (this.activeMode === 'none') return;
    logger.debug('[InputHandler] switching to disabled mode (Ink takes over)');
    this.teardownCurrentMode();
  }

  /**
   * Switch to PTY raw mode. Called when daemon switches Claude back to local PTY.
   * Resumes forwarding raw bytes as pty_data.
   */
  switchToPtyMode(): void {
    if (this.stopped || !process.stdin.isTTY) return;
    if (this.activeMode === 'pty') return;
    logger.debug('[InputHandler] switching to PTY mode');
    this.teardownCurrentMode();
    this.startPtyMode();
  }

  // ---------------------------------------------------------------------------
  // Line mode (default: Codex / Gemini / OpenCode and non-TTY sessions)
  // ---------------------------------------------------------------------------

  private startLineMode(): void {
    this.activeMode = 'line';
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    this.rl.on('line', line => {
      if (this.stopped) return;
      const text = line.trim();
      if (!text) return;
      logger.info('[InputHandler] line input forwarded', {
        sessionId: this.sessionId,
        length: text.length,
      });
      this.ipcClient.send({ type: 'send_input', sessionId: this.sessionId, text });
    });

    this.rl.on('close', () => {
      if (!this.stopped) {
        logger.debug('[InputHandler] stdin closed');
        this.stop();
      }
    });

    // Ctrl+C: send abort to daemon then let the session clean up
    process.on('SIGINT', () => {
      if (this.stopped) return;
      logger.debug('[InputHandler] SIGINT received, aborting session');
      this.ipcClient.send({ type: 'abort', sessionId: this.sessionId });
      this.stop();
    });
  }

  // ---------------------------------------------------------------------------
  // Raw PTY mode (Claude local mode)
  // ---------------------------------------------------------------------------

  private startPtyMode(): void {
    this.activeMode = 'pty';
    process.stdin.setRawMode(true);
    process.stdin.resume();

    this.stdinDataHandler = (chunk: Buffer | string) => {
      if (this.stopped) return;

      // If another subsystem (e.g. Ink/useInput) set stdin encoding to 'utf8',
      // Node will emit strings instead of Buffers. PTY input must be binary-safe,
      // so normalize to Buffer before base64 encoding.
      const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;

      // Ctrl+C (0x03): send abort instead of forwarding the byte
      if (buf.length === 1 && buf[0] === 0x03) {
        logger.debug('[InputHandler] PTY Ctrl+C, aborting session');
        this.ipcClient.send({ type: 'abort', sessionId: this.sessionId });
        this.stop();
        return;
      }

      // Encode as base64 to preserve binary content (arrow keys, ESC sequences, etc.)
      this.ipcClient.send({
        type: 'pty_data',
        sessionId: this.sessionId,
        data: buf.toString('base64'),
      });
    };
    process.stdin.on('data', this.stdinDataHandler);

    // Forward terminal resize events so the agent's PTY can be resized accordingly
    this.resizeHandler = () => {
      if (this.stopped) return;
      const cols = process.stdout.columns ?? 80;
      const rows = process.stdout.rows ?? 24;
      logger.debug('[InputHandler] terminal resized', { cols, rows });
      this.ipcClient.send({
        type: 'pty_resize',
        sessionId: this.sessionId,
        cols,
        rows,
      });
    };
    process.stdout.on('resize', this.resizeHandler);
    // Send initial size so daemon can configure the PTY before any output arrives
    this.resizeHandler();

    logger.debug('[InputHandler] PTY mode started', {
      cols: process.stdout.columns,
      rows: process.stdout.rows,
    });
  }

  // ---------------------------------------------------------------------------
  // Idle mode (remote SDK — spectator, any keypress triggers switch back)
  // ---------------------------------------------------------------------------

  private startIdleMode(): void {
    this.activeMode = 'idle';
    process.stdin.setRawMode(true);
    process.stdin.resume();

    /** Whether a switch_mode has already been sent (prevent duplicates from held keys). */
    let switchRequested = false;
    /**
     * Ignore non-Ctrl-C input for a short warmup period after entering idle mode.
     * When the PTY process is killed during the local→remote switch, leftover escape
     * sequences or terminal restoration bytes may arrive on stdin and would otherwise
     * be misinterpreted as an intentional keypress, immediately switching back to local.
     */
    let ready = false;
    setTimeout(() => {
      ready = true;
    }, 300);

    this.stdinDataHandler = (chunk: Buffer | string) => {
      if (this.stopped) return;

      const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;

      // Ctrl+C (0x03): abort the session even in idle mode (always works, no warmup)
      if (buf.length === 1 && buf[0] === 0x03) {
        logger.debug('[InputHandler] idle Ctrl+C, aborting session');
        this.ipcClient.send({ type: 'abort', sessionId: this.sessionId });
        this.stop();
        return;
      }

      // During warmup, discard input (PTY transition noise)
      if (!ready) {
        logger.debug('[InputHandler] idle warmup, discarding input');
        return;
      }

      // Any other keypress → request switch back to local mode (once)
      if (!switchRequested) {
        switchRequested = true;
        logger.info('[InputHandler] keypress in idle mode, requesting switch to local');
        this.ipcClient.send({ type: 'switch_mode', sessionId: this.sessionId });
      }
    };
    process.stdin.on('data', this.stdinDataHandler);

    logger.debug('[InputHandler] idle mode started (press any key to switch back to local)');
  }

  // ---------------------------------------------------------------------------
  // Teardown
  // ---------------------------------------------------------------------------

  private teardownCurrentMode(): void {
    // Remove stdin data listener
    if (this.stdinDataHandler) {
      process.stdin.removeListener('data', this.stdinDataHandler);
      this.stdinDataHandler = null;
    }

    // Remove resize listener
    if (this.resizeHandler) {
      process.stdout.removeListener('resize', this.resizeHandler);
      this.resizeHandler = null;
    }

    // Close readline if active
    if (this.rl) {
      this.rl.close();
      this.rl = undefined;
    }

    // Restore cooked mode if terminal was in raw mode
    if (process.stdin.isTTY && (this.activeMode === 'pty' || this.activeMode === 'idle')) {
      try {
        process.stdin.setRawMode(false);
      } catch {
        /* ignore */
      }
    }

    // Pause stdin so the Node event loop can exit.
    // resume() was called in startPtyMode/startIdleMode; without pause(),
    // stdin keeps the process alive even after all handlers are removed.
    if (this.stopped) {
      process.stdin.pause();
    }

    this.activeMode = 'none';
  }
}
