import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");

function readRepo(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function readPackageJson(): { scripts: Record<string, string>; dependencies?: Record<string, string>; bin: Record<string, string>; engines: { node: string } } {
  return JSON.parse(readRepo("package.json"));
}

function stripComments(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

describe("package guards", () => {
  it("ships no runtime dependencies", () => {
    expect(readPackageJson().dependencies).toBeUndefined();
  });

  it("declares the Node 20.11 runtime floor", () => {
    expect(readPackageJson().engines.node).toBe(">=20.11");
  });

  it("points bin at dist/cli.js", () => {
    expect(readPackageJson().bin["httptape"]).toBe("./dist/cli.js");
  });

  it("keeps the tape format constant in sync with the code", () => {
    expect(readRepo("src/types.ts")).toContain("TAPE_FORMAT_VERSION = 1");
  });
});

describe("tsconfig guards", () => {
  it("base config is noEmit and includes tests", () => {
    const base = JSON.parse(stripComments(readRepo("tsconfig.json")));
    expect(base.compilerOptions.noEmit).toBe(true);
    expect(base.include).toContain("tests");
    expect(base.compilerOptions.types).toEqual(["node"]);
  });

  it("build config overrides noEmit and compiles only src", () => {
    const build = JSON.parse(stripComments(readRepo("tsconfig.build.json")));
    expect(build.compilerOptions.noEmit).toBe(false);
    expect(build.include).toEqual(["src"]);
    expect(build.compilerOptions.rootDir).toBe("src");
  });
});

describe("ci guards", () => {
  it("pins workflow actions to commit SHAs", () => {
    const ci = readRepo(".github/workflows/ci.yml");
    const uses = ci.split("\n").filter((l) => l.trim().startsWith("- uses:") || l.trim().startsWith("uses:"));
    expect(uses.length).toBeGreaterThan(0);
    for (const line of uses) {
      expect(line).toMatch(/@[0-9a-f]{40}/);
      expect(line).toMatch(/# v\d+\.\d+\.\d+$/);
    }
  });

  it("runs the audit gate after npm ci", () => {
    const ci = readRepo(".github/workflows/ci.yml");
    const auditAt = ci.indexOf("npm audit --audit-level=high");
    const ciAt = ci.indexOf("npm ci");
    expect(auditAt).toBeGreaterThan(-1);
    expect(ciAt).toBeGreaterThan(-1);
    expect(auditAt).toBeGreaterThan(ciAt);
  });

  it("declares least-privilege workflow permissions", () => {
    expect(readRepo(".github/workflows/ci.yml")).toContain("permissions:");
    expect(readRepo(".github/workflows/ci.yml")).toContain("contents: read");
  });
});

describe("release workflow guards", () => {
  it("gates the tag against package.json before any gh call", () => {
    const yml = readRepo(".github/workflows/release.yml");
    const gate = yml.indexOf("package.json");
    const firstGh = yml.indexOf("gh ");
    expect(gate).toBeGreaterThan(-1);
    expect(firstGh).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(firstGh);
  });

  it("uploads both versioned and stable tarball names", () => {
    const yml = readRepo(".github/workflows/release.yml");
    expect(yml).toContain("httptape-");
    expect(yml).toContain("httptape.tgz");
  });
});
