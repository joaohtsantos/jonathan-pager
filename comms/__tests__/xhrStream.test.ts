// xhrStream over an RN-like XHR shim against a slow NDJSON server — including
// the Expo dev-client body-peek interceptor that withheld the stream on device.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { STREAM_ACCEPT } from "../broker";
import { xhrStream } from "../stream";
import { makeXHRShim } from "./xhrShim";

let server: http.Server;
let base = "";

beforeAll(async () => {
  // Like the broker: headers flushed at once, then one NDJSON line every 50 ms, never ends.
  server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/x-ndjson" });
    res.flushHeaders();
    let n = 0;
    const t = setInterval(() => {
      // split a line across writes to exercise the line buffer
      res.write(`{"type":"heartbeat","n":${n}`);
      res.write(`}\n`);
      n++;
    }, 50);
    res.on("close", () => clearInterval(t));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

function withXHR<T>(shim: unknown, fn: () => Promise<T>): Promise<T> {
  const g = globalThis as { XMLHttpRequest?: unknown };
  const prev = g.XMLHttpRequest;
  g.XMLHttpRequest = shim;
  return fn().finally(() => {
    g.XMLHttpRequest = prev;
  });
}

async function collect(accept: string, ms: number) {
  const lines: string[] = [];
  let opened = false;
  const h = xhrStream({ url: base + "/v1/stream", headers: { Accept: accept }, onLine: (l) => lines.push(l), onOpen: () => (opened = true) });
  await new Promise((r) => setTimeout(r, ms));
  h.abort();
  await h.done;
  return { lines, opened };
}

describe("xhrStream (RN XMLHttpRequest)", () => {
  it("delivers NDJSON lines incrementally while the response is still open", async () => {
    const { lines, opened } = await withXHR(makeXHRShim(), () => collect(STREAM_ACCEPT, 400));
    expect(opened).toBe(true);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(JSON.parse(lines[0])).toEqual({ type: "heartbeat", n: 0 });
  });

  it("under the dev-client peek interceptor, a plain NDJSON Accept never opens", async () => {
    const { lines, opened } = await withXHR(makeXHRShim({ devClientPeek: true }), () => collect("application/x-ndjson", 400));
    expect(opened).toBe(false);
    expect(lines).toEqual([]);
  });

  it("the broker's stream Accept opts out of the peek and streams", async () => {
    expect(STREAM_ACCEPT.startsWith("text/event-stream")).toBe(true);
    const { lines, opened } = await withXHR(makeXHRShim({ devClientPeek: true }), () => collect(STREAM_ACCEPT, 400));
    expect(opened).toBe(true);
    expect(lines.length).toBeGreaterThanOrEqual(3);
  });
});
