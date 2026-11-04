import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { rmSync } from "node:fs";
import { record } from "../src/record.js";
import { replay, resetReplay } from "../src/replay.js";
import { loadTape } from "../src/tape.js";
import { NoMatchError } from "../src/errors.js";

let server: Server;
let port = 0;

beforeAll(async () => {
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
