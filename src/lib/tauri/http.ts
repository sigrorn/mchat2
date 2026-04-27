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
  // #124: abort the stream if no bytes arrive on the reader for this
  // many ms. On timeout the helper throws HttpError(408, /timeout/)
  // so retryManager picks it up as transient. Defaults to no timeout.
  idleTimeoutMs?: number;
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
    if (opts.idleTimeoutMs && opts.idleTimeoutMs > 0) {
      yield* readSSEFramesWithIdleTimeout(reader, opts.idleTimeoutMs);
    } else {
      yield* readSSEFrames(reader);
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
    // #205: the 200-char truncation here was making trace files and
    // the UI error bubble show only the provider error preamble,
    // dropping the parameter-name + allowed-values detail that's the
    // whole reason you'd read the body. Provider error bodies are
    // bounded by what providers actually send (kilobytes at worst);
    // the bubble is full-width and wraps. Keep the full body.
    super(`HTTP ${status}: ${body}`);
    this.name = "HttpError";
  }
}

/**
 * Consume an SSE reader without an idle timeout. Extracted so the
 * streaming loop is shared with the idle-timeout variant.
 */
export async function* readSSEFrames(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncIterable<SSEEvent> {
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    // Normalize CRLF → LF so the frame-boundary search works regardless
    // of whether the server emits Unix or DOS line endings. Google's
    // Gemini streamGenerateContent endpoint emits \r\n\r\n between
    // events, which used to cause indexOf('\n\n') to never match and
    // the entire stream to be silently discarded.
    buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const evt = parseSSEFrame(frame);
      if (evt) yield evt;
    }
  }
}

/**
 * Consume an SSE reader with a per-chunk idle timeout (#124). If no
 * bytes arrive within `idleTimeoutMs`, cancel the reader and throw
 * HttpError(408, /timeout/) — the message substring "timeout" and 408
 * status are what adapters map to transient so retryManager fires.
 * The timer is reset on every successful chunk, not on every frame.
 */
export async function* readSSEFramesWithIdleTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  idleTimeoutMs: number,
): AsyncIterable<SSEEvent> {
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        void reader.cancel().catch(() => {});
        reject(new HttpError(408, `stream idle timeout (${idleTimeoutMs}ms with no bytes)`));
      }, idleTimeoutMs);
    });
    let result: ReadableStreamReadResult<Uint8Array>;
    try {
      result = await Promise.race([reader.read(), timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (result.done) break;
    buf += decoder.decode(result.value, { stream: true }).replace(/\r\n/g, "\n");
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const evt = parseSSEFrame(frame);
      if (evt) yield evt;
    }
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
