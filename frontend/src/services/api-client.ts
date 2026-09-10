import { createRequestId } from "../utils/request-id";

export interface StandardSuccessResponse<TData> {
  success: true;
  data: TData;
  meta: Record<string, unknown>;
  requestId: string;
}

export interface StandardErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId: string;
}

export type StandardApiResponse<TData> = StandardSuccessResponse<TData> | StandardErrorResponse;

export interface ApiRequestOptions extends Omit<RequestInit, "headers" | "body"> {
  accessToken?: string;
  qrSessionToken?: string;
  branchId?: string;
  idempotencyKey?: string;
  requestId?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export class ApiClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly requestId: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

const defaultBaseUrl = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000/api/v1";

export class ApiClient {
  constructor(private readonly baseUrl: string = defaultBaseUrl) {}

  async request<TData>(path: string, options: ApiRequestOptions = {}): Promise<StandardSuccessResponse<TData>> {
    const requestId = options.requestId ?? createRequestId();
    const headers = this.buildHeaders(options, requestId);
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const payload = (await response.json()) as StandardApiResponse<TData>;

    if (!response.ok || !payload.success) {
      const errorPayload = payload.success ? undefined : payload.error;
      throw new ApiClientError(
        errorPayload?.code ?? "INTERNAL_ERROR",
        errorPayload?.message ?? "Request failed",
        payload.requestId ?? requestId,
        errorPayload?.details
      );
    }

    return payload;
  }

  private buildHeaders(options: ApiRequestOptions, requestId: string): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Request-Id": requestId,
      ...options.headers
    };

    if (options.accessToken) {
      headers.Authorization = `Bearer ${options.accessToken}`;
    }
    if (options.qrSessionToken) {
      headers.Authorization = `Bearer ${options.qrSessionToken}`;
    }
    if (options.branchId) {
      headers["X-Branch-Id"] = options.branchId;
    }
    if (options.idempotencyKey) {
      headers["Idempotency-Key"] = options.idempotencyKey;
    }

    return headers;
  }
}

export const apiClient = new ApiClient();
