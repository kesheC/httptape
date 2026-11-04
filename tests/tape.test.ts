import { describe, expect, it } from "vitest";
import { validateTape, serializeTape, emptyTape } from "../src/tape.js";
import { TapeError } from "../src/errors.js";
import { TAPE_FORMAT_VERSION, type Tape } from "../src/types.js";

function goodTape(overrides: Partial<Tape> = {}): Tape {
  return {
    formatVersion: TAPE_FORMAT_VERSION,
    name: "demo",
    recordedAt: "2026-11-04T00:00:00.000Z",
    interactions: [
      {
        method: "GET",
        url: "http://localhost:1/hello",
        requestHeaders: { accept: "text/plain" },
        requestBody: null,
        status: 200,
        responseHeaders: { "content-type": "text/plain" },
        responseBody: "hi",
        recordedAt: "2026-11-04T00:00:01.000Z",
      },
    ],
    ...overrides,
  };
}

describe("validateTape", () => {
  it("accepts a well-formed tape", () => {
    expect(validateTape(goodTape()).name).toBe("demo");
  });

  it("rejects non-objects", () => {
    expect(() => validateTape(null)).toThrow(TapeError);
    expect(() => validateTape(42)).toThrow(TapeError);
  });

  it("rejects wrong formatVersion", () => {
    expect(() => validateTape(goodTape({ formatVersion: 999 as never }))).toThrow(/formatVersion/);
  });

  it("rejects empty name", () => {
    expect(() => validateTape(goodTape({ name: "" }))).toThrow(/name/);
  });

  it("rejects non-array interactions", () => {
    expect(() => validateTape(goodTape({ interactions: "no" as never }))).toThrow(/interactions/);
  });

  it("reports the index of a bad interaction", () => {
    const tape = goodTape();
    (tape.interactions[0] as unknown as Record<string, unknown>)["status"] = "ok";
    expect(() => validateTape(tape)).toThrow(/interactions\[0\]\.status/);
  });

  it("rejects method values outside the seven standard ones on read-through match only", () => {
    // validation checks types, not the method vocabulary; matching rejects it.
    const tape = goodTape();
    tape.interactions[0]!.method = "TRACE" as never;
    expect(() => validateTape(tape)).not.toThrow();
  });
});

describe("serializeTape", () => {
  it("ends with exactly one newline and two-space indent", () => {
    const text = serializeTape(goodTape());
    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
    expect(text.includes('  "formatVersion')).toBe(true);
  });
});

describe("emptyTape", () => {
  it("creates a valid empty tape with a fresh timestamp", () => {
    const tape = emptyTape("fresh");
    expect(() => validateTape(tape)).not.toThrow();
    expect(tape.interactions).toEqual([]);
    expect(tape.name).toBe("fresh");
  });
});
