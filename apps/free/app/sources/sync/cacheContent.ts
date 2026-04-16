export function serializeCachedContent(content: unknown): string {
  return JSON.stringify(content ?? null);
}

export function sanitizeSQLiteParams<T>(params: readonly (T | undefined)[]): Array<Exclude<T, undefined> | null> {
  return params.map(param => (param === undefined ? null : param)) as Array<Exclude<T, undefined> | null>;
}
