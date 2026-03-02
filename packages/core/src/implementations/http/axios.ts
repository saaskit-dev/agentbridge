/**
 * Axios HTTP client implementation
 * 
 * Note: axios is a peer dependency. Make sure to install it:
 * npm install axios
 */

import type {
  IHttpClient,
  HttpClientOptions,
  RequestConfig,
  HttpResponse,
} from '../../interfaces/http';
import { registerHttpClientFactory } from '../../interfaces/http';

// Dynamic import to handle optional peer dependency
let axios: typeof import('axios').default | null = null;

async function getAxios() {
  if (!axios) {
    try {
      axios = (await import('axios')).default;
    } catch {
      throw new Error('axios is not installed. Run: npm install axios');
    }
  }
  return axios;
}

/**
 * Axios HTTP client implementation
 */
class AxiosHttpClient implements IHttpClient {
  private baseUrl?: string;
  private defaultHeaders?: Record<string, string>;
  private timeout?: number;

  constructor(options?: HttpClientOptions) {
    this.baseUrl = options?.baseUrl;
    this.defaultHeaders = options?.defaultHeaders;
    this.timeout = options?.timeout;
  }

  private async doRequest<T>(
    url: string,
    config?: RequestConfig
  ): Promise<HttpResponse<T>> {
    const ax = await getAxios();

    const fullUrl = this.baseUrl ? `${this.baseUrl}${url}` : url;

    const response = await ax.request({
      url: fullUrl,
      method: config?.method,
      headers: { ...this.defaultHeaders, ...config?.headers },
      data: config?.body,
      timeout: config?.timeout ?? this.timeout,
      signal: config?.signal,
    });

    return {
      data: response.data as T,
      status: response.status,
      headers: response.headers as Record<string, string>,
    };
  }

  async request<T = unknown>(
    url: string,
    config?: RequestConfig
  ): Promise<HttpResponse<T>> {
    return this.doRequest<T>(url, config);
  }

  async get<T = unknown>(
    url: string,
    config?: Omit<RequestConfig, 'method' | 'body'>
  ): Promise<HttpResponse<T>> {
    return this.doRequest<T>(url, { ...config, method: 'GET' });
  }

  async post<T = unknown>(
    url: string,
    body?: unknown,
    config?: Omit<RequestConfig, 'method'>
  ): Promise<HttpResponse<T>> {
    return this.doRequest<T>(url, { ...config, method: 'POST', body });
  }

  async put<T = unknown>(
    url: string,
    body?: unknown,
    config?: Omit<RequestConfig, 'method'>
  ): Promise<HttpResponse<T>> {
    return this.doRequest<T>(url, { ...config, method: 'PUT', body });
  }

  async delete<T = unknown>(
    url: string,
    config?: Omit<RequestConfig, 'method'>
  ): Promise<HttpResponse<T>> {
    return this.doRequest<T>(url, { ...config, method: 'DELETE' });
  }
}

// Register factory
registerHttpClientFactory('axios', (options) => new AxiosHttpClient(options));

// Export for direct use
export { AxiosHttpClient };
