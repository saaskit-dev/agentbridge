import { describe, it, expect } from 'vitest';
import { extractErrorMessage, safeStringify, toError } from '../stringify';

describe('safeStringify', () => {
  it('returns "null" for null', () => {
    expect(safeStringify(null)).toBe('null');
  });

  it('returns "undefined" for undefined', () => {
    expect(safeStringify(undefined)).toBe('undefined');
  });

  it('returns the string itself for strings', () => {
    expect(safeStringify('hello')).toBe('hello');
    expect(safeStringify('')).toBe('');
  });

  it('converts numbers to string', () => {
    expect(safeStringify(42)).toBe('42');
    expect(safeStringify(0)).toBe('0');
    expect(safeStringify(NaN)).toBe('NaN');
  });

  it('converts booleans to string', () => {
    expect(safeStringify(true)).toBe('true');
    expect(safeStringify(false)).toBe('false');
  });

  it('converts bigint to string', () => {
    expect(safeStringify(BigInt(123))).toBe('123');
  });

  it('converts symbols to string', () => {
    expect(safeStringify(Symbol('test'))).toBe('Symbol(test)');
  });

  it('returns .message for Error instances', () => {
    expect(safeStringify(new Error('something failed'))).toBe('something failed');
  });

  it('returns .message for TypeError', () => {
    expect(safeStringify(new TypeError('bad type'))).toBe('bad type');
  });

  it('returns error name for Error with empty message', () => {
    const e = new Error();
    expect(safeStringify(e)).toBe('Error');
  });

  it('returns custom error name for Error with empty message', () => {
    const e = new Error();
    e.name = 'CustomError';
    expect(safeStringify(e)).toBe('CustomError');
  });

  it('JSON-stringifies plain objects (the key difference from String())', () => {
    expect(safeStringify({ code: 500, message: 'No capacity' })).toBe(
      '{"code":500,"message":"No capacity"}'
    );
  });

  it('JSON-stringifies arrays', () => {
    expect(safeStringify([1, 2, 3])).toBe('[1,2,3]');
  });

  it('handles circular references gracefully', () => {
    const obj: Record<string, unknown> = {};
    obj.self = obj;
    expect(safeStringify(obj)).toBe('[object Object]');
  });

  it('converts Date to ISO string', () => {
    const d = new Date('2026-01-01T00:00:00.000Z');
    expect(safeStringify(d)).toBe('2026-01-01T00:00:00.000Z');
  });

  it('converts RegExp to string', () => {
    expect(safeStringify(/test/gi)).toBe('/test/gi');
  });

  it('describes functions by name', () => {
    function myFn() {}
    expect(safeStringify(myFn)).toBe('[Function: myFn]');
    expect(safeStringify(() => {})).toBe('[Function]');
  });
});

describe('toError', () => {
  it('returns the Error as-is if already an Error', () => {
    const e = new Error('original');
    expect(toError(e)).toBe(e);
  });

  it('wraps a string in an Error', () => {
    const e = toError('something broke');
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe('something broke');
  });

  it('wraps an object in an Error with JSON message', () => {
    const e = toError({ code: 500, message: 'No capacity' });
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe('{"code":500,"message":"No capacity"}');
  });

  it('wraps null in an Error', () => {
    const e = toError(null);
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe('null');
  });

  it('wraps undefined in an Error', () => {
    const e = toError(undefined);
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe('undefined');
  });

  it('wraps a number in an Error', () => {
    const e = toError(404);
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe('404');
  });

  it('preserves TypeError subclass', () => {
    const e = new TypeError('bad');
    expect(toError(e)).toBe(e);
    expect(toError(e)).toBeInstanceOf(TypeError);
  });
});

describe('extractErrorMessage', () => {
  it('returns string values unchanged', () => {
    expect(extractErrorMessage('plain error')).toBe('plain error');
  });

  it('prefers object error field', () => {
    expect(extractErrorMessage({ error: 'File has not been read yet' })).toBe(
      'File has not been read yet'
    );
  });

  it('supports nested Error instances', () => {
    expect(extractErrorMessage({ error: new Error('boom') })).toBe('boom');
  });

  it('falls back to message for structured errors', () => {
    expect(extractErrorMessage({ message: 'Permission denied', code: 'EACCES' })).toBe(
      'Permission denied'
    );
  });

  it('prefers stderr when present', () => {
    expect(extractErrorMessage({ stderr: 'command failed', exitCode: 1 })).toBe('command failed');
  });

  it('stringifies unknown objects safely', () => {
    expect(extractErrorMessage({ foo: 'bar' })).toBe('{"foo":"bar"}');
  });
});
