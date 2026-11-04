import { describe, expect, it } from "vitest";
import { findMatch, describeRequest, normalizeCaptured } from "../src/match.js";
import { TapeError } from "../src/errors.js";
import type { Interaction } from "../src/types.js";

function interaction(overrides: Partial<Interaction> = {}): Interaction {
  return {
    method: "GET",
    url: "http://localhost:1/api",
    requestHeaders: {},
    requestBody: null,
    status: 200,
    responseHeaders: {},
    responseBody: "ok",
    recordedAt: "2026-11-04T00:00:00.000Z",
    ...overrides,
  };
}

describe("findMatch", () => {
  it("matches method and URL exactly", () => {
    const list = [interaction()];
    expect(findMatch(list, { method: "GET", url: "http://localhost:1/api" })?.index).toBe(0);
  });

  it("matches method case-insensitively", () => {
    const list = [interaction()];
    expect(findMatch(list, { method: "get", url: "http://localhost:1/api" })?.index).toBe(0);
  });

  it("does not match a different URL", () => {
    expect(findMatch([interaction()], { method: "GET", url: "http://localhost:1/other" })).toBeNull();
  });

  it("ignores URL fragments on both sides", () => {
    const list = [interaction({ url: "http://localhost:1/api" })];
    expect(findMatch(list, { method: "GET", url: "http://localhost:1/api#frag" })?.index).toBe(0);
  });

  it("skips already-played interactions and serves the second copy", () => {
    const list = [interaction(), interaction({ responseBody: "second" })];
    const played = new Set([0]);
    const found = findMatch(list, { method: "GET", url: "http://localhost:1/api" }, { played });
    expect(found?.index).toBe(1);
    expect(found?.interaction.responseBody).toBe("second");
  });

  it("matchBody: same body matches, different body does not", () => {
    const list = [interaction({ requestBody: "a=1" })];
    const opts = { matchBody: true };
    expect(findMatch(list, { method: "GET", url: "http://localhost:1/api", body: "a=1" }, opts)?.index).toBe(0);
    expect(findMatch(list, { method: "GET", url: "http://localhost:1/api", body: "a=2" }, opts)).toBeNull();
    expect(findMatch(list, { method: "GET", url: "http://localhost:1/api", body: null }, opts)).toBeNull();
  });

  it("matchBody: recorded null matches absent body", () => {
    const list = [interaction()];
    expect(
      findMatch(list, { method: "GET", url: "http://localhost:1/api", body: null }, { matchBody: true })?.index,
    ).toBe(0);
  });

  it("throws on a method outside the recorded vocabulary", () => {
    expect(() => findMatch([], { method: "TRACE", url: "http://x/" })).toThrow(TapeError);
  });

  it("picks the first matching interaction in order", () => {
    const list = [interaction({ responseBody: "first" }), interaction({ responseBody: "next" })];
    expect(findMatch(list, { method: "GET", url: "http://localhost:1/api" })?.interaction.responseBody).toBe("first");
  });
});

describe("describeRequest", () => {
  it("uppercases the method in the description", () => {
    expect(describeRequest({ method: "post", url: "http://x/y" })).toBe("POST http://x/y");
  });
});

describe("normalizeCaptured", () => {
  it("uppercases the captured method and keeps the rest", () => {
    const out = normalizeCaptured({ method: "put", url: "u", headers: { a: "b" }, body: "x" });
    expect(out.method).toBe("PUT");
    expect(out.headers).toEqual({ a: "b" });
    expect(out.body).toBe("x");
  });
});
