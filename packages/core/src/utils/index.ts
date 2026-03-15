// Encoding utilities
export {
  encodeBase64,
  encodeBase64Url,
  decodeBase64,
  decodeBase64Url,
  encodeUtf8,
  decodeUtf8,
  encodeHex,
  decodeHex,
} from './encoding';

// Crypto utilities
export {
  hmacSha512,
  deriveKey,
  deriveSecretKeyTreeRoot,
  deriveSecretKeyTreeChild,
  type KeyTreeState,
} from './crypto';

// Concurrency utilities
export { AsyncLock } from './asyncLock';

// File utilities
export { atomicFileWrite, atomicWriteJson } from './fileAtomic';

// JSON utilities
export {
  deterministicStringify,
  hashObject,
  deepEqual,
  objectKey,
  type DeterministicJsonOptions,
} from './deterministicJson';

// Message queues
export { ModeAwareMessageQueue } from './modeAwareMessageQueue';
export { AsyncIterableQueue } from './asyncIterableQueue';
export { PushableAsyncIterable, createPushableAsyncIterable } from './pushableAsyncIterable';

// Environment variable utilities
export { expandEnvVars, expandEnvironmentVariables, getUndefinedVars } from './expandEnvVars';

// Stringify utilities
export { safeStringify, toError } from './stringify';

// System utilities
export {
  startCaffeinate,
  stopCaffeinate,
  isCaffeinateRunning,
  type CaffeinateOptions,
} from './caffeinate';

// Tmux utilities
export {
  isTmuxAvailable,
  isInsideTmux,
  getTmuxEnvironment,
  getSessionName,
  getWindowIndex,
  getPaneIndex,
  execTmux,
  newSession,
  attachSession,
  killSession,
  listSessions,
  sendKeys,
  splitWindow,
  selectPane,
  resizePane,
  setOption,
  renameSession,
  renameWindow,
  capturePane,
  sessionExists,
  type TmuxControlSequence,
  type TmuxEnvironment,
  type TmuxCommandResult,
  type TmuxSessionInfo,
} from './tmux';
