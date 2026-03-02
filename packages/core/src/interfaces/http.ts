/**
 * HTTP client interface
 */

/** HTTP request configuration */
export interface RequestConfig {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
  signal?: AbortSignal;
}

/** HTTP response */
export interface HttpResponse<T = unknown> {
  data: T;
  status: number;
  headers: Record<string, string>;
}

/** HTTP client factory type */
export type HttpClientFactory = (options?: HttpClientOptions) => IHttpClient;

/** HTTP client options */
export interface HttpClientOptions {
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
  timeout?: number;
}

/** HTTP client interface */
export interface IHttpClient {
  /** Make a generic request */
  request<T = unknown>(url: string, config?: RequestConfig): Promise<HttpResponse<T>>;

  /** GET request */
  get<T = unknown>(url: string, config?: Omit<RequestConfig, 'method' | 'body'>): Promise<HttpResponse<T>>;

  /** POST request */
  post<T = unknown>(url: string, body?: unknown, config?: Omit<RequestConfig, 'method'>): Promise<HttpResponse<T>>;

  /** PUT request */
  put<T = unknown>(url: string, body?: unknown, config?: Omit<RequestConfig, 'method'>): Promise<HttpResponse<T>>;

  /** DELETE request */
  delete<T = unknown>(url: string, config?: Omit<RequestConfig, 'method'>): Promise<HttpResponse<T>>;
}

// Factory registry
const httpClientFactories = new Map<string, HttpClientFactory>();

/** Register an HTTP client factory */
export function registerHttpClientFactory(type: string, factory: HttpClientFactory): void {
  httpClientFactories.set(type, factory);
}

/** Create an HTTP client instance */
export function createHttpClient(type: string, options?: HttpClientOptions): IHttpClient {
  const factory = httpClientFactories.get(type);
  if (!factory) {
    throw new Error(`HTTP client factory not found: ${type}. Available: ${[...httpClientFactories.keys()].join(', ')}`);
  }
  return factory(options);
}
