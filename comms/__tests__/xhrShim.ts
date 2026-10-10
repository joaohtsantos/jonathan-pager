// Minimal XMLHttpRequest for Node that behaves like React Native's on Android:
// readyState 2 when headers arrive, readyState 3 + onprogress with a growing
// responseText as chunks arrive, readyState 4 at the end.
//
// `devClientPeek` emulates the Expo dev-client OkHttp network interceptor over
// HTTP/2: unless the request Accept or response Content-Type starts with
// text/event-stream, the response is withheld until 1 MiB arrives or the body
// ends (HTTP/2 has no chunked Transfer-Encoding to skip it).
import http from "node:http";
import https from "node:https";

const PEEK_LIMIT = 1_048_576;

export function makeXHRShim(opts: { devClientPeek?: boolean } = {}) {
  return class ShimXHR {
    readyState = 0;
    status = 0;
    responseText = "";
    responseType = "";
    onreadystatechange: (() => void) | null = null;
    onprogress: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    private method = "GET";
    private url = "";
    private headers: Record<string, string> = {};
    private req: http.ClientRequest | null = null;
    private aborted = false;

    open(method: string, url: string) {
      this.method = method;
      this.url = url;
      this.readyState = 1;
    }
    setRequestHeader(k: string, v: string) {
      this.headers[k] = v;
    }
    private set(state: number) {
      this.readyState = state;
      this.onreadystatechange?.();
    }
    send() {
      const mod = this.url.startsWith("https:") ? https : http;
      this.req = mod.request(this.url, { method: this.method, headers: this.headers }, (res) => {
        const ct = String(res.headers["content-type"] ?? "");
        const accept = this.headers.Accept ?? this.headers.accept ?? "";
        const peek = opts.devClientPeek && !ct.startsWith("text/event-stream") && !accept.startsWith("text/event-stream");
        let held = "";
        let released = !peek;
        const release = () => {
          if (released || this.aborted) return;
          released = true;
          this.status = res.statusCode ?? 0;
          this.set(2);
          if (held) {
            this.responseText += held;
            this.set(3);
            this.onprogress?.();
          }
        };
        if (!peek) {
          this.status = res.statusCode ?? 0;
          this.set(2);
        }
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          if (this.aborted) return;
          if (!released) {
            held += chunk;
            if (held.length > PEEK_LIMIT) release();
            return;
          }
          this.responseText += chunk;
          this.set(3);
          this.onprogress?.();
        });
        res.on("end", () => {
          if (this.aborted) return;
          release();
          this.set(4);
        });
        res.on("error", () => this.fail());
      });
      this.req.on("error", () => this.fail());
      this.req.end();
    }
    private fail() {
      if (this.aborted) return;
      this.status = 0;
      this.set(4);
      this.onerror?.();
    }
    abort() {
      if (this.aborted) return;
      this.aborted = true;
      this.req?.destroy();
      this.status = 0;
      this.set(4);
      this.onabort?.();
    }
  };
}
