// ------------------------------------------------------------------
// Component: HTTP transport
// Responsibility: Single mockable surface for all outbound HTTP. Exposes
//                 streamSSE for provider adapters and a plain request for
//                 non-streaming calls.
// Collaborators: providers/*, tests inject a mock via __setImpl.
// ------------------------------------------------------------------

export interface SSEEvent {
  // Parsed SSE "event:" field (default "message").
  event: string;
  // Raw data payload (SSE "data:" lines joined by \n).
  data: string;
}

export interface StreamSSEOptions {
  url: string;
  method?: "POST" | "GET";
  headers?: Record<string, string>;
  // Serialized body. Callers build provider-specific JSON.
  body?: string;
  // Aborts the request and closes the reader. Emits no further events.
  signal?: AbortSignal;
}

export interface HttpRequestOptions {
  url: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: string;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface HttpImpl {
  streamSSE(opts: StreamSSEOptions): AsyncIterable<SSEEvent>;
  request(opts: HttpRequestOptions): Promise<HttpResponse>;
}

// Default impl uses @tauri-apps/plugin-http's fetch which routes through
// the Rust side and bypasses webview CORS. Loaded lazily so unit tests
// running under Node never pull Tauri modules.
const defaultImpl: HttpImpl = {
  async *streamSSE(opts) {
    const { fetch } = await import("@tauri-apps/plugin-http");
    const init: RequestInit = { method: opts.method ?? "POST" };
    if (opts.headers) init.headers = opts.headers;
    if (opts.body !== undefined) init.body = opts.body;
    if (opts.signal) init.signal = opts.signal;
    const res = await fetch(opts.url, init);
    if (!res.ok) {
      throw new HttpError(res.status, await res.text());
    }
    // Assert the response is actually SSE. Some providers return HTTP
    // 200 with a JSON error body or a plain-JSON stream; without this
    // guard, streamSSE would silently yield zero frames and the caller
    // would see an empty response with no diagnostic.
    const ct = res.headers.get("content-type") ?? "";
    if (!/text\/event-stream/i.test(ct)) {
      const body = await res.text();
      throw new HttpError(
        res.status,
        `expected text/event-stream, got '${ct}'${body ? `: ${body}` : ""}`,
      );
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error("HTTP: response has no body");
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const evt = parseSSEFrame(frame);
        if (evt) yield evt;
      }
    }
  },
  async request(opts) {
    const { fetch } = await import("@tauri-apps/plugin-http");
    const init: RequestInit = { method: opts.method ?? "GET" };
    if (opts.headers) init.headers = opts.headers;
    if (opts.body !== undefined) init.body = opts.body;
    const res = await fetch(opts.url, init);
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k] = v;
    });
    return { status: res.status, headers, body: await res.text() };
  },
};

let impl: HttpImpl = defaultImpl;

export function streamSSE(opts: StreamSSEOptions): AsyncIterable<SSEEvent> {
  return impl.streamSSE(opts);
}

export function request(opts: HttpRequestOptions): Promise<HttpResponse> {
  return impl.request(opts);
}

// Test-only. Vitest replaces the impl before each test.
export function __setImpl(mock: HttpImpl): void {
  impl = mock;
}

export function __resetImpl(): void {
  impl = defaultImpl;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`HTTP ${status}: ${body.slice(0, 200)}`);
    this.name = "HttpError";
  }
}

function parseSSEFrame(frame: string): SSEEvent | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const valueRaw = colon === -1 ? "" : line.slice(colon + 1);
    const value = valueRaw.startsWith(" ") ? valueRaw.slice(1) : valueRaw;
    if (field === "event") event = value;
    else if (field === "data") dataLines.push(value);
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}

// Exported for unit tests of frame parsing.
export const __test = { parseSSEFrame };
