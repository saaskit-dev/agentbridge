/**
 * Pino-compatible logger shim for Fastify's loggerInstance.
 *
 * Fastify expects a pino-like object. This shim maps pino's calling
 * convention (object-first) to our telemetry Logger while stripping
 * Fastify's raw Node.js IncomingMessage/ServerResponse objects.
 */

import { Logger } from '@agentbridge/core/telemetry';

const fastifyInner = new Logger('fastify');

interface PinoLikeLogger {
  info(obj: any, msg?: string, ...a: any[]): void;
  warn(obj: any, msg?: string, ...a: any[]): void;
  error(obj: any, msg?: string, ...a: any[]): void;
  debug(obj: any, msg?: string, ...a: any[]): void;
  fatal(obj: any, msg?: string, ...a: any[]): void;
  trace(..._args: any[]): void;
  silent(..._args: any[]): void;
  level: string;
  child(bindings: Record<string, unknown>): PinoLikeLogger;
}

function pinoNoop() {}

function slimFastifyLog(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;

  const result: Record<string, unknown> = {};

  // incoming request: { req: { raw: { method, url, headers }, ... }, reqId }
  if (obj.req?.raw) {
    result.method = obj.req.raw.method;
    result.url = obj.req.raw.url;
    if (obj.reqId) result.reqId = obj.reqId;
    const traceId = obj.req.raw.headers?.['x-trace-id'];
    if (traceId) result.traceId = traceId;
    const contentLength = obj.req.raw.headers?.['content-length'];
    if (contentLength) result.reqBodySize = parseInt(contentLength, 10) || undefined;
    return result;
  }

  // request completed: { res: { raw: { _header }, ... }, responseTime, reqId }
  if (obj.res?.raw) {
    const header: string = obj.res.raw._header ?? '';
    const statusMatch = header.match(/HTTP\/[\d.]+ (\d+)/);
    if (statusMatch) result.status = parseInt(statusMatch[1], 10);
    if (obj.responseTime != null) result.ms = Math.round(obj.responseTime * 10) / 10;
    if (obj.reqId) result.reqId = obj.reqId;
    // Include URL so 404s and slow requests are self-contained in the log
    const url = obj.req?.raw?.url ?? obj.res?.raw?.req?.url;
    if (url) result.url = url;
    return result;
  }

  // other objects — copy as-is but drop raw Node objects
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object' && ('socket' in v || '_readableState' in v)) continue;
    result[k] = v;
  }
  return result;
}

function createPinoShim(
  inner: Logger,
  bindings?: Record<string, unknown>
): PinoLikeLogger {
  const dispatch = (
    method: 'info' | 'warn' | 'error' | 'debug',
    obj: any,
    msg?: string
  ): void => {
    const slim = slimFastifyLog(obj);
    const data: Record<string, unknown> = bindings
      ? { ...bindings, ...(typeof slim === 'object' && slim !== null ? slim : { raw: slim }) }
      : typeof slim === 'object' && slim !== null
      ? (slim as Record<string, unknown>)
      : { raw: slim };

    const message = typeof slim === 'string' ? slim : (msg ?? '');
    if (method === 'error') {
      inner.error(message, undefined, data);
    } else {
      inner[method](message, data);
    }
  };

  return {
    info: (obj: any, msg?: string) => dispatch('info', obj, msg),
    warn: (obj: any, msg?: string) => dispatch('warn', obj, msg),
    error: (obj: any, msg?: string) => dispatch('error', obj, msg),
    debug: (obj: any, msg?: string) => dispatch('debug', obj, msg),
    fatal: (obj: any, msg?: string) => dispatch('error', obj, msg),
    trace: pinoNoop,
    silent: pinoNoop,
    level: process.env.LOG_LEVEL || 'debug',
    child: (childBindings: Record<string, unknown>) =>
      createPinoShim(inner, { ...bindings, ...childBindings }),
  };
}

export function createFastifyLogger(): PinoLikeLogger {
  return createPinoShim(fastifyInner);
}
