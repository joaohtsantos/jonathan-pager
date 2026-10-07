// NDJSON streaming for GET /v1/stream. React Native's fetch cannot stream a
// response body, but its XMLHttpRequest delivers incremental responseText on
// progress events; Node (tests, integration) uses fetch + ReadableStream.

export interface StreamRequest {
  url: string;
  headers: Record<string, string>;
  onLine: (line: string) => void;
  onOpen?: () => void;
}

export interface StreamHandle {
  /** Resolves when the stream ends (closed, error or abort). Rejects on HTTP errors. */
  done: Promise<void>;
  abort(): void;
}

export type StreamOpener = (req: StreamRequest) => StreamHandle;

export class HTTPStatusError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export const xhrStream: StreamOpener = (req) => {
  const xhr = new XMLHttpRequest();
  let offset = 0;
  let buf = "";
  let opened = false;
  const pump = () => {
    const text = xhr.responseText ?? "";
    if (text.length <= offset) return;
    buf += text.slice(offset);
    offset = text.length;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) req.onLine(line);
    }
    // responseText only grows; recycle long-lived connections (caller reconnects).
    if (offset > 4_000_000) xhr.abort();
  };
  const done = new Promise<void>((resolve, reject) => {
    xhr.open("GET", req.url);
    for (const [k, v] of Object.entries(req.headers)) xhr.setRequestHeader(k, v);
    xhr.responseType = "text";
    xhr.onreadystatechange = () => {
      if (xhr.readyState >= 2 && !opened) {
        if (xhr.status === 200) {
          opened = true;
          req.onOpen?.();
        }
      }
      if (xhr.readyState >= 3 && xhr.status === 200) pump();
      if (xhr.readyState === 4) {
        if (xhr.status === 200 || xhr.status === 0) resolve();
        else {
          let code = "stream_unavailable";
          try {
            code = JSON.parse(xhr.responseText).code ?? code;
          } catch {}
          reject(new HTTPStatusError(xhr.status, code, `stream HTTP ${xhr.status}`));
        }
      }
    };
    xhr.onprogress = pump;
    xhr.onerror = () => resolve();
    xhr.onabort = () => resolve();
    xhr.send();
  });
  return { done, abort: () => xhr.abort() };
};

export function fetchStream(fetchImpl: typeof fetch = fetch): StreamOpener {
  return (req) => {
    const ctl = new AbortController();
    const done = (async () => {
      let res: Response;
      try {
        res = await fetchImpl(req.url, { headers: req.headers, signal: ctl.signal });
      } catch {
        return;
      }
      if (res.status !== 200) {
        let code = "stream_unavailable";
        try {
          code = (await res.json()).code ?? code;
        } catch {}
        throw new HTTPStatusError(res.status, code, `stream HTTP ${res.status}`);
      }
      req.onOpen?.();
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (line) req.onLine(line);
          }
        }
      } catch {
        // aborted or connection dropped
      }
    })();
    return { done, abort: () => ctl.abort() };
  };
}

export function defaultStreamOpener(): StreamOpener {
  return typeof XMLHttpRequest !== "undefined" ? xhrStream : fetchStream();
}
