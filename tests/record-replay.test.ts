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
