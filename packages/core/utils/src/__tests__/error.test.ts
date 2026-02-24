import { describe, it, expect } from 'vitest';
import {
  AgentBridgeError,
  EncryptionError,
  StorageError,
  TransportError,
  ProtocolError,
  AuthError,
  PermissionError,
  SessionError,
  wrapError,
  isAgentBridgeError,
  hasErrorCode,
  getErrorMessage,
} from '../error';

describe('Error classes', () => {
  describe('AgentBridgeError', () => {
    it('creates error with code', () => {
      const error = new AgentBridgeError('Test error', 'TEST_CODE');
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.name).toBe('AgentBridgeError');
    });

    it('creates error with cause', () => {
      const cause = new Error('Original error');
      const error = new AgentBridgeError('Wrapped error', 'WRAPPED', cause);

      expect(error.cause).toBe(cause);
    });
  });

  describe('EncryptionError', () => {
    it('creates encryption error', () => {
      const error = new EncryptionError('Encryption failed');
      expect(error.code).toBe('ENCRYPTION_ERROR');
      expect(error.name).toBe('EncryptionError');
    });
  });

  describe('StorageError', () => {
    it('creates storage error', () => {
      const error = new StorageError('Storage failed');
      expect(error.code).toBe('STORAGE_ERROR');
      expect(error.name).toBe('StorageError');
    });
  });

  describe('TransportError', () => {
    it('creates transport error', () => {
      const error = new TransportError('Connection failed');
      expect(error.code).toBe('TRANSPORT_ERROR');
      expect(error.name).toBe('TransportError');
    });
  });

  describe('ProtocolError', () => {
    it('creates protocol error', () => {
      const error = new ProtocolError('Invalid message');
      expect(error.code).toBe('PROTOCOL_ERROR');
      expect(error.name).toBe('ProtocolError');
    });
  });

  describe('AuthError', () => {
    it('creates auth error', () => {
      const error = new AuthError('Authentication failed');
      expect(error.code).toBe('AUTH_ERROR');
      expect(error.name).toBe('AuthError');
    });
  });

  describe('PermissionError', () => {
    it('creates permission error', () => {
      const error = new PermissionError('Access denied');
      expect(error.code).toBe('PERMISSION_ERROR');
      expect(error.name).toBe('PermissionError');
    });
  });

  describe('SessionError', () => {
    it('creates session error', () => {
      const error = new SessionError('Session not found');
      expect(error.code).toBe('SESSION_ERROR');
      expect(error.name).toBe('SessionError');
    });
  });
});

describe('wrapError', () => {
  it('returns AgentBridgeError as-is', () => {
    const original = new AgentBridgeError('Original', 'CODE');
    const wrapped = wrapError(original);

    expect(wrapped).toBe(original);
  });

  it('wraps Error into AgentBridgeError', () => {
    const original = new Error('Test error');
    const wrapped = wrapError(original);

    expect(wrapped).toBeInstanceOf(AgentBridgeError);
    expect(wrapped.message).toBe('Test error');
    expect(wrapped.code).toBe('WRAPPED_ERROR');
    expect(wrapped.cause).toBe(original);
  });

  it('wraps non-Error into AgentBridgeError', () => {
    const wrapped = wrapError('string error');

    expect(wrapped).toBeInstanceOf(AgentBridgeError);
    expect(wrapped.message).toBe('string error');
    expect(wrapped.cause).toBeUndefined();
  });

  it('wraps into custom error class', () => {
    const original = new Error('Transport issue');
    const wrapped = wrapError(original, TransportError);

    expect(wrapped).toBeInstanceOf(TransportError);
    expect(wrapped.message).toBe('Transport issue');
  });
});

describe('isAgentBridgeError', () => {
  it('returns true for AgentBridgeError', () => {
    expect(isAgentBridgeError(new AgentBridgeError('test', 'CODE'))).toBe(true);
    expect(isAgentBridgeError(new EncryptionError('test'))).toBe(true);
  });

  it('returns false for regular Error', () => {
    expect(isAgentBridgeError(new Error('test'))).toBe(false);
  });

  it('returns false for non-Error', () => {
    expect(isAgentBridgeError('error')).toBe(false);
    expect(isAgentBridgeError(null)).toBe(false);
  });
});

describe('hasErrorCode', () => {
  it('returns true when code matches', () => {
    const error = new AgentBridgeError('test', 'TEST_CODE');
    expect(hasErrorCode(error, 'TEST_CODE')).toBe(true);
  });

  it('returns false when code does not match', () => {
    const error = new AgentBridgeError('test', 'TEST_CODE');
    expect(hasErrorCode(error, 'OTHER_CODE')).toBe(false);
  });

  it('returns false for non-AgentBridgeError', () => {
    const error = new Error('test');
    expect(hasErrorCode(error, 'TEST_CODE')).toBe(false);
  });
});

describe('getErrorMessage', () => {
  it('extracts message from Error', () => {
    expect(getErrorMessage(new Error('test message'))).toBe('test message');
  });

  it('converts non-Error to string', () => {
    expect(getErrorMessage('string error')).toBe('string error');
    expect(getErrorMessage(123)).toBe('123');
    expect(getErrorMessage(null)).toBe('null');
  });
});
