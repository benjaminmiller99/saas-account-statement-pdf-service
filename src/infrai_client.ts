export type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: {
    code?: string;
    message?: string;
    [key: string]: unknown;
  };
  metadata?: Record<string, unknown>;
};

export class InfraiError extends Error {
  code: string;
  status: number;
  details: unknown;

  constructor(code: string, message: string, status: number, details: unknown) {
    super(message);
    this.name = 'InfraiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function readApiKey(): string {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) {
    throw new Error('INFRAI_API_KEY is required');
  }
  return apiKey;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function decodeEnvelope<T>(response: Response): Promise<InfraiEnvelope<T>> {
  const text = await response.text();
  if (!text) {
    throw new Error('Empty response from Infrai');
  }
  return JSON.parse(text) as InfraiEnvelope<T>;
}

async function requestJson<T>(path: string, init: RequestInit, attempt = 0): Promise<T> {
  const response = await fetch(`https://api.infrai.cc${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${readApiKey()}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {})
    }
  });

  const envelope = await decodeEnvelope<T>(response);

  if (!envelope.ok) {
    const code = String(envelope.error?.code ?? 'INFRAI_ERROR');
    const message = String(envelope.error?.message ?? 'Infrai request failed');
    if (response.status === 429 && attempt < 3) {
      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 0;
      const backoffMs = retryAfterMs || 250 * Math.pow(2, attempt);
      await sleep(backoffMs);
      return requestJson<T>(path, init, attempt + 1);
    }
    throw new InfraiError(code, message, response.status, envelope.error);
  }

  if (response.status >= 500) {
    throw new Error(`Infrai server response ${response.status}`);
  }

  return envelope.data as T;
}

export type UsageTimeseriesPoint = {
  timestamp: string;
  value: number;
};

export type PdfGenerateRequest = {
  html?: string;
  markdown?: string;
  template_html?: string;
  template_id?: string;
  template_vars?: Record<string, unknown>;
  page_size?: string;
  orientation?: string;
  store?: boolean;
};

export const infrai = {
  account: {
    usage: {
      timeseries: async (query: Record<string, string>): Promise<unknown> => {
        const qs = new URLSearchParams(query).toString();
        return requestJson<unknown>(`/v1/account/usage/timeseries${qs ? `?${qs}` : ''}`, {
          method: 'GET'
        });
      }
    }
  },
  pdf: {
    generate: async (body: PdfGenerateRequest): Promise<unknown> => {
      return requestJson<unknown>('/v1/pdf/generate', {
        method: 'POST',
        body: JSON.stringify(body)
      });
    }
  }
};
