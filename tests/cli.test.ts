import { describe, expect, it } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, VERSION } from "../src/cli.js";
import { emptyTape, saveTape } from "../src/tape.js";

function capture(): { out: string[]; err: string[]; stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout: { write: (s: string) => { out.push(s); return true; } } as unknown as NodeJS.WritableStream,
    stderr: { write: (s: string) => { err.push(s); return true; } } as unknown as NodeJS.WritableStream,
  };
}

describe("cli main", () => {
  it("prints help on no args", () => {
    const c = capture();
    expect(main([], c.stdout, c.stderr)).toBe(0);
    expect(c.out.join("")).toContain("httptape - record and replay");
  });

  it("prints version", () => {
    const c = capture();
    expect(main(["--version"], c.stdout, c.stderr)).toBe(0);
    expect(c.out.join("")).toBe("httptape " + VERSION + "\n");
  });

  it("rejects unknown commands", () => {
    const c = capture();
    expect(main(["frobnicate"], c.stdout, c.stderr)).toBe(1);
    expect(c.err.join("")).toContain("unknown command");
  });

  it("inspect requires a file", () => {
    const c = capture();
    expect(main(["inspect"], c.stdout, c.stderr)).toBe(1);
    expect(c.err.join("")).toContain("at least one tape file");
  });

  it("inspect validates a good tape", async () => {
    const dir = mkdtempSync(join(tmpdir(), "httptape-"));
    const path = join(dir, "t.json");
    await saveTape(path, emptyTape("t"));
    const c = capture();
    expect(main(["inspect", path], c.stdout, c.stderr)).toBe(0);
    expect(c.out.join("")).toContain("0 interactions");
    rmSync(dir, { recursive: true, force: true });
  });

  it("inspect --json reports ok true with counts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "httptape-"));
    const path = join(dir, "t.json");
    await saveTape(path, emptyTape("t"));
    const c = capture();
    expect(main(["inspect", "--json", path], c.stdout, c.stderr)).toBe(0);
    const parsed = JSON.parse(c.out.join("")) as { ok: boolean; interactions: number }[];
    expect(parsed[0]!.ok).toBe(true);
    expect(parsed[0]!.interactions).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it("inspect flags a broken tape and exits 1", () => {
    const dir = mkdtempSync(join(tmpdir(), "httptape-"));
    const path = join(dir, "bad.json");
    writeFileSync(path, "{ not json");
    const c = capture();
    expect(main(["inspect", path], c.stdout, c.stderr)).toBe(1);
    expect(c.err.join("")).toContain("INVALID");
    rmSync(dir, { recursive: true, force: true });
  });

  it("inspect rejects unknown flags", () => {
    const c = capture();
    expect(main(["inspect", "--bogus", "x.json"], c.stdout, c.stderr)).toBe(1);
    expect(c.err.join("")).toContain("unknown flag");
  });
});
