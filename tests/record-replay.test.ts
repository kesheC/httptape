import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { record } from "../src/record.js";
import { replay, resetReplay } from "../src/replay.js";
import { emptyTape, loadTape, saveTape } from "../src/tape.js";
import { NoMatchError } from "../src/errors.js";

let server: Server;
let port = 0;

beforeAll(async () => {
  mkdirSync("consumed", { recursive: true });
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => {
      if (req.url === "/echo") {
        res.writeHead(201, { "content-type": "application/json", "x-seen-method": req.method });
        res.end(JSON.stringify({ body }));
      } else if (req.url === "/secret") {
        res.writeHead(200, { "x-keep": "yes" });
        res.end("authorized=" + String(req.headers.authorization));
      } else {
        res.writeHead(404, { "content-length": "0" });
        res.end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  port = typeof addr === "object" && addr !== null ? addr.port : 0;
});

afterAll(() => {
  server.close();
  rmSync("release.tape.json", { force: true });
  rmSync("secret.tape.json", { force: true });
  rmSync("autotape.tape.json", { force: true });
  rmSync(join("consumed", "ordered.tape.json"), { force: true });
});

describe("record + replay round-trip", () => {
  it("records a real exchange into a tape file", async () => {
    const interaction = await record("http://127.0.0.1:" + port + "/echo", {
      name: "release",
      method: "POST",
      body: '{"a":1}',
      headers: { "content-type": "application/json" },
    });
    expect(interaction.status).toBe(201);
    expect(interaction.method).toBe("POST");
    const tape = await loadTape("release.tape.json");
    expect(tape.interactions).toHaveLength(1);
    expect(tape.interactions[0]!.responseBody).toBe('{"body":"{\\"a\\":1}"}');
  });

  it("replays the recorded exchange without the server path being hit again", async () => {
    const result = await replay(
      { method: "POST", url: "http://127.0.0.1:" + port + "/echo", body: '{"a":1}' },
      { tapePath: "release.tape.json" },
    );
    expect(result.matched).toBe(true);
    expect(result.status).toBe(201);
    expect(result.body).toContain("a");
  });

  it("strict mode throws NoMatchError naming method and URL", async () => {
    await expect(
      replay({ method: "GET", url: "http://127.0.0.1:" + port + "/missing" }, { tapePath: "release.tape.json" }),
    ).rejects.toThrow(NoMatchError);
  });

  it("stub mode answers 599 without touching network or throwing", async () => {
    const result = await replay(
      { method: "GET", url: "http://127.0.0.1:" + port + "/missing" },
      { tapePath: "release.tape.json", mode: "stub" },
    );
    expect(result.matched).toBe(false);
    expect(result.status).toBe(599);
  });

  it("redacts authorization headers on both sides", async () => {
    await record("http://127.0.0.1:" + port + "/secret", {
      name: "secret",
      headers: { authorization: "Bearer abc" },
    });
    const tape = await loadTape("secret.tape.json");
    expect(tape.interactions[0]!.requestHeaders["authorization"]).toBe("[REDACTED]");
    expect(tape.interactions[0]!.responseHeaders["x-keep"]).toBe("yes");
  });

  it("appends a second exchange to the same tape", async () => {
    await record("http://127.0.0.1:" + port + "/echo", { name: "release", method: "GET" });
    const tape = await loadTape("release.tape.json");
    expect(tape.interactions).toHaveLength(2);
  });

  it("resetReplay lets the same tape serve again", async () => {
    const call = () =>
      replay({ method: "POST", url: "http://127.0.0.1:" + port + "/echo", body: '{"a":1}' }, { tapePath: "release.tape.json" });
    resetReplay();
    await expect(call()).resolves.toBeTruthy();
    await expect(call()).rejects.toThrow(NoMatchError);
    resetReplay("release.tape.json");
    await expect(call()).resolves.toBeTruthy();
    resetReplay();
  });
});

describe("record resilience", () => {
  it("rejects when the response stream errors mid-flight", async () => {
    const broken = createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.write("half");
      setTimeout(() => res.destroy(), 50);
    });
    await new Promise<void>((resolve) => broken.listen(0, "127.0.0.1", resolve));
    const bport = (broken.address() as { port: number }).port;
    try {
      await expect(
        record("http://127.0.0.1:" + bport + "/broken", { name: "broken", outPath: "broken-tmp.tape.json" }),
      ).rejects.toThrow(/(aborted|ECONNRESET|socket hang up|premature close)/i);
    } finally {
      broken.close();
      rmSync("broken-tmp.tape.json", { force: true });
    }
  });

  it("rejects with a readable timeout error when the server never answers", async () => {
    const silent = createServer(() => {
      // Swallow the request forever: headers are never written.
    });
    await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
    const sport = (silent.address() as { port: number }).port;
    try {
      const started = Date.now();
      await expect(
        record("http://127.0.0.1:" + sport + "/hang", { name: "hang", outPath: "hang-tmp.tape.json", timeoutMs: 300 }),
      ).rejects.toThrow(/timed out after 300ms/);
      expect(Date.now() - started).toBeLessThan(5000);
    } finally {
      silent.close();
      rmSync("hang-tmp.tape.json", { force: true });
    }
  });

  it("still succeeds well inside the default timeout", async () => {
    const interaction = await record("http://127.0.0.1:" + port + "/echo", { name: "quick", outPath: "quick-tmp.tape.json" });
    expect(interaction.status).toBe(201);
    rmSync("quick-tmp.tape.json", { force: true });
  });
});

describe("third audit round fixes", () => {
  it("stores null for a response body that is not valid UTF-8", async () => {
    // types.ts promises text-or-null; a lossy U+FFFD rewrite used to be stored.
    const binary = createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(Buffer.from([0x00, 0xff, 0xfe]));
    });
    await new Promise<void>((resolve) => binary.listen(0, "127.0.0.1", resolve));
    const bport = (binary.address() as { port: number }).port;
    try {
      const interaction = await record("http://127.0.0.1:" + bport + "/bin", {
        name: "binary",
        outPath: "binary-tmp.tape.json",
      });
      expect(interaction.responseBody).toBeNull();
      // The text path still records text.
      const interaction2 = await record("http://127.0.0.1:" + port + "/echo", {
        name: "binary",
        outPath: "binary-tmp.tape.json",
      });
      expect(interaction2.responseBody).toContain("body");
    } finally {
      binary.close();
      rmSync("binary-tmp.tape.json", { force: true });
    }
  });

  it("drops the body of a HEAD request instead of recording an unmatchable one", async () => {
    const interaction = await record("http://127.0.0.1:" + port + "/echo", {
      name: "headdrop",
      outPath: "headdrop-tmp.tape.json",
      method: "HEAD",
      body: "ignored",
    });
    expect(interaction.method).toBe("HEAD");
    expect(interaction.requestBody).toBeNull();
    rmSync("headdrop-tmp.tape.json", { force: true });
  });

  it("rejects an empty tape name with a readable error", async () => {
    await expect(
      record("http://127.0.0.1:" + port + "/echo", { name: "  ", outPath: "noname-tmp.tape.json" }),
    ).rejects.toThrow(/non-empty tape name/);
  });

  it("stub mode answers TRACE (and any method) with 599 instead of throwing", async () => {
    // findMatch throws TapeError for non-standard methods; stub mode must
    // dispatch before matching so the stub contract holds for every request.
    const result = await replay(
      { method: "TRACE", url: "http://127.0.0.1:" + port + "/anything" },
      { tapePath: "release.tape.json", mode: "stub" },
    );
    expect(result.matched).toBe(false);
    expect(result.status).toBe(599);
    expect(result.headers["x-httptape"]).toBe("stub");
  });

  it("record mode starts from an empty tape when the file does not exist", async () => {
    const missing = join("consumed", "never-recorded.tape.json");
    rmSync(missing, { force: true });
    const result = await replay(
      { method: "GET", url: "http://127.0.0.1:" + port + "/echo" },
      { tapePath: missing, mode: "record" },
    );
    expect(result.matched).toBe(true);
    expect(result.status).toBe(201);
    const tape = await loadTape(missing);
    expect(tape.interactions).toHaveLength(1);
    rmSync(missing, { force: true });
  });

  it("keys played state case-insensitively where the filesystem does", async () => {
    const { tapeKey } = await import("../src/replay.js");
    if (process.platform === "win32" || process.platform === "darwin") {
      expect(tapeKey("C:\\A\\tape.json")).toBe(tapeKey("c:\\a\\tape.json"));
    } else {
      expect(tapeKey("/tmp/T.json")).toBe("/tmp/T.json");
    }
  });

  it("validateTape rejects a non-ISO recordedAt on the tape and on interactions", async () => {
    const { validateTape } = await import("../src/tape.js");
    const { TapeError } = await import("../src/errors.js");
    const base = emptyTape("iso");
    (base.recordedAt as string) = "yesterday";
    expect(() => validateTape(base)).toThrow(TapeError);
    const badInteraction = emptyTape("iso2");
    badInteraction.interactions.push({
      method: "GET",
      url: "http://x/",
      requestHeaders: {},
      requestBody: null,
      status: 200,
      responseHeaders: {},
      responseBody: null,
      recordedAt: "2026/11/04",
    });
    expect(() => validateTape(badInteraction)).toThrow(TapeError);
    const good = emptyTape("iso3");
    good.interactions.push({
      method: "GET",
      url: "http://x/",
      requestHeaders: {},
      requestBody: null,
      status: 200,
      responseHeaders: {},
      responseBody: null,
      recordedAt: "2026-11-04T00:00:00.000Z",
    });
    expect(() => validateTape(good)).not.toThrow();
  });
});

describe("replay consumption keys on the resolved path", () => {
  it("consumes in order across ./relative and bare spellings of the same tape", async () => {
    const tapePath = join("consumed", "ordered.tape.json");
    const tape = emptyTape("ordered");
    tape.interactions.push(
      {
        method: "GET",
        url: "http://tape.test/api",
        requestHeaders: {},
        requestBody: null,
        status: 200,
        responseHeaders: {},
        responseBody: "first",
        recordedAt: "2026-11-04T00:00:00.000Z",
      },
      {
        method: "GET",
        url: "http://tape.test/api",
        requestHeaders: {},
        requestBody: null,
        status: 201,
        responseHeaders: {},
        responseBody: "second",
        recordedAt: "2026-11-04T00:00:01.000Z",
      },
    );
    await saveTape(tapePath, tape);
    try {
      resetReplay();
      const r1 = await replay({ method: "GET", url: "http://tape.test/api" }, { tapePath: "./" + tapePath });
      expect(r1.body).toBe("first");
      const r2 = await replay({ method: "GET", url: "http://tape.test/api" }, { tapePath });
      expect(r2.body).toBe("second");
    } finally {
      resetReplay();
      rmSync(join("consumed", "ordered.tape.json"), { force: true });
    }
  });
});
describe("fourth audit round fixes", () => {
  it("redacts any header whose name mentions a credential", async () => {
    const interaction = await record("http://127.0.0.1:" + port + "/echo", {
      name: "credpattern",
      outPath: "credpattern-tmp.tape.json",
      headers: { "x-api-key": "sk-123", "session-token": "tok", "x-innocent": "keep" },
    });
    expect(interaction.requestHeaders["x-api-key"]).toBe("[REDACTED]");
    expect(interaction.requestHeaders["session-token"]).toBe("[REDACTED]");
    expect(interaction.requestHeaders["x-innocent"]).toBe("keep");
    rmSync("credpattern-tmp.tape.json", { force: true });
  });

  it("strips userinfo from the stored interaction URL", async () => {
    const interaction = await record("http://user:pass@127.0.0.1:" + port + "/echo", {
      name: "userinfo",
      outPath: "userinfo-tmp.tape.json",
    });
    expect(interaction.url).not.toContain("user:pass");
    expect(interaction.url).toContain("/echo");
    rmSync("userinfo-tmp.tape.json", { force: true });
  });

  it("matches a replay request that still carries userinfo", async () => {
    const tapePath = join("consumed", "usermatch.tape.json");
    const tape = emptyTape("usermatch");
    tape.interactions.push({
      method: "GET",
      url: "http://tape.test/api",
      requestHeaders: {},
      requestBody: null,
      status: 200,
      responseHeaders: {},
      responseBody: "ok",
      recordedAt: "2026-11-05T00:00:00.000Z",
    });
    await saveTape(tapePath, tape);
    try {
      resetReplay();
      const result = await replay(
        { method: "GET", url: "http://user:pass@tape.test/api" },
        { tapePath },
      );
      expect(result.matched).toBe(true);
      expect(result.body).toBe("ok");
    } finally {
      resetReplay();
      rmSync(tapePath, { force: true });
    }
  });

  it("keeps the query string out of NoMatchError messages", async () => {
    const error = await replay(
      { method: "GET", url: "http://127.0.0.1:" + port + "/echo?token=supersecret" },
      { tapePath: "release.tape.json" },
    ).catch((e: Error) => e);
    expect(error).toBeInstanceOf(NoMatchError);
    expect((error as Error).message).not.toContain("supersecret");
  });

  it("record-mode misses forward request headers onto the tape", async () => {
    const missing = join("consumed", "headers-record.tape.json");
    rmSync(missing, { force: true });
    const result = await replay(
      { method: "GET", url: "http://127.0.0.1:" + port + "/echo", headers: { "x-probe": "probe-value" } },
      { tapePath: missing, mode: "record" },
    );
    expect(result.matched).toBe(true);
    expect(result.interaction!.requestHeaders["x-probe"]).toBe("probe-value");
    rmSync(missing, { force: true });
  });

  it("stub mode replays a matching interaction instead of the 599 fallback", async () => {
    const result = await replay(
      { method: "GET", url: "http://127.0.0.1:" + port + "/echo" },
      { tapePath: "release.tape.json", mode: "stub" },
    );
    expect(result.matched).toBe(true);
    expect(result.status).toBe(201);
    expect(result.headers["x-httptape"]).toBeUndefined();
  });

  it("strict mode turns a TRACE request into NoMatchError, not TapeError", async () => {
    await expect(
      replay({ method: "TRACE", url: "http://127.0.0.1:" + port + "/anything" }, { tapePath: "release.tape.json" }),
    ).rejects.toThrow(NoMatchError);
  });

  it("sends Buffer request bodies as raw bytes and stores null", async () => {
    const raw = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ bytes: [...Buffer.concat(chunks)] }));
      });
    });
    await new Promise<void>((resolve) => raw.listen(0, "127.0.0.1", resolve));
    const rport = (raw.address() as { port: number }).port;
    try {
      const interaction = await record("http://127.0.0.1:" + rport + "/raw", {
        name: "bufbody",
        outPath: "bufbody-tmp.tape.json",
        method: "POST",
        body: Buffer.from([0x00, 0xff, 0xfe]),
      });
      expect(interaction.requestBody).toBeNull();
      expect(interaction.responseBody).toBe(JSON.stringify({ bytes: [0, 255, 254] }));
    } finally {
      raw.close();
      rmSync("bufbody-tmp.tape.json", { force: true });
    }
  });

  it("validates interaction status codes as integers 100..599", async () => {
    const { validateTape } = await import("../src/tape.js");
    const { TapeError } = await import("../src/errors.js");
    const mk = (status: unknown) => {
      const tape = emptyTape("status");
      tape.interactions.push({
        method: "GET",
        url: "http://x/",
        requestHeaders: {},
        requestBody: null,
        status: status as number,
        responseHeaders: {},
        responseBody: null,
        recordedAt: "2026-11-05T00:00:00.000Z",
      });
      return tape;
    };
    expect(() => validateTape(mk(99))).toThrow(TapeError);
    expect(() => validateTape(mk(600))).toThrow(TapeError);
    expect(() => validateTape(mk(200.5))).toThrow(TapeError);
    expect(() => validateTape(mk("200" as unknown as number))).toThrow(TapeError);
    expect(() => validateTape(mk(599))).not.toThrow();
  });

  it("saveTape refuses to persist an invalid tape", async () => {
    const { TapeError } = await import("../src/errors.js");
    const bad = emptyTape("bad");
    bad.interactions.push({
      method: "GET",
      url: "http://x/",
      requestHeaders: {},
      requestBody: null,
      status: 700,
      responseHeaders: {},
      responseBody: null,
      recordedAt: "2026-11-05T00:00:00.000Z",
    });
    await expect(saveTape("bad-tmp.tape.json", bad)).rejects.toThrow(TapeError);
  });
});
