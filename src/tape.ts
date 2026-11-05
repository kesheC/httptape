import { randomBytes } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { TAPE_FORMAT_VERSION, type Interaction, type Tape } from "./types.js";
import { TapeError } from "./errors.js";

/** Shape of an ISO-8601 timestamp as this package writes it (always UTC "Z"). */
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

/** Validate a parsed JSON value as a {@link Tape}; throws {@link TapeError} with the reason. */
export function validateTape(value: unknown): Tape {
  if (typeof value !== "object" || value === null) {
    throw new TapeError("tape must be a JSON object");
  }
  const t = value as Record<string, unknown>;
  if (t["formatVersion"] !== TAPE_FORMAT_VERSION) {
    throw new TapeError(
      `unsupported tape formatVersion ${JSON.stringify(t["formatVersion"])}, expected ${TAPE_FORMAT_VERSION}`,
    );
  }
  if (typeof t["name"] !== "string" || t["name"].length === 0) {
    throw new TapeError("tape.name must be a non-empty string");
  }
  if (typeof t["recordedAt"] !== "string" || !ISO_8601.test(t["recordedAt"])) {
    throw new TapeError("tape.recordedAt must be an ISO-8601 string");
  }
  if (!Array.isArray(t["interactions"])) {
    throw new TapeError("tape.interactions must be an array");
  }
  for (const [i, raw] of t["interactions"].entries()) {
    validateInteraction(raw, i);
  }
  return value as Tape;
}

function validateInteraction(raw: unknown, index: number): void {
  if (typeof raw !== "object" || raw === null) {
    throw new TapeError(`interactions[${index}] must be an object`);
  }
  const it = raw as Record<string, unknown>;
  const need = (key: string, type: string): void => {
    const v = it[key];
    const ok =
      (type === "string" && typeof v === "string") ||
      (type === "string|null" && (v === null || typeof v === "string")) ||
      (type === "number" && typeof v === "number") ||
      (type === "object" && typeof v === "object" && v !== null && !Array.isArray(v));
    if (!ok) {
      throw new TapeError(`interactions[${index}].${key} must be ${type}`);
    }
  };
  need("method", "string");
  need("url", "string");
  needHeaders("requestHeaders", it["requestHeaders"], index);
  need("requestBody", "string|null");
  const status = it["status"];
  if (typeof status !== "number" || !Number.isInteger(status) || status < 100 || status > 599) {
    throw new TapeError(`interactions[${index}].status must be an HTTP status code (integer 100..599)`);
  }
  needHeaders("responseHeaders", it["responseHeaders"], index);
  need("responseBody", "string|null");
  if (typeof it["recordedAt"] !== "string" || !ISO_8601.test(it["recordedAt"])) {
    throw new TapeError(`interactions[${index}].recordedAt must be an ISO-8601 string`);
  }
}

function needHeaders(key: string, value: unknown, index: number): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TapeError(`interactions[${index}].${key} must be object`);
  }
  for (const [name, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v !== "string") {
      throw new TapeError(`interactions[${index}].${key}.${name} must be a string`);
    }
  }
}

/** Read and validate a tape file. */
export async function loadTape(path: string): Promise<Tape> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (cause) {
    const err = cause as NodeJS.ErrnoException;
    const wrapped = new TapeError(`cannot read tape at ${path}: ${err.message}`);
    (wrapped as NodeJS.ErrnoException).code = err.code;
    (wrapped as unknown as { cause?: unknown }).cause = err;
    throw wrapped;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new TapeError(`tape at ${path} is not valid JSON: ${(cause as Error).message}`);
  }
  return validateTape(parsed);
}

/** Serialize a tape to pretty JSON (2-space, trailing newline) for on-disk stability. */
export function serializeTape(tape: Tape): string {
  return `${JSON.stringify(tape, null, 2)}\n`;
}

/**
 * Write a tape file atomically: serialize to a unique temp file in the same
 * directory, then rename it over the target, so a reader (or a crash
 * mid-write) never observes a half-written tape.
 */
export async function saveTape(path: string, tape: Tape): Promise<void> {
  // Validate before writing so the package can never persist a tape its own
  // readers reject (a NaN status serialized to null used to self-destruct).
  validateTape(tape);
  const tempPath = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tempPath, serializeTape(tape), "utf8");
  try {
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

/** Build an empty tape with the given name. */
export function emptyTape(name: string): Tape {
  return {
    formatVersion: TAPE_FORMAT_VERSION,
    name,
    recordedAt: new Date().toISOString(),
    interactions: [] as Interaction[],
  };
}