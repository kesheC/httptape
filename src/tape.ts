import { readFile, writeFile } from "node:fs/promises";
import { TAPE_FORMAT_VERSION, type Interaction, type Tape } from "./types.js";
import { TapeError } from "./errors.js";

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
  if (typeof t["recordedAt"] !== "string") {
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
  need("requestHeaders", "object");
  need("requestBody", "string|null");
  need("status", "number");
  need("responseHeaders", "object");
  need("responseBody", "string|null");
  need("recordedAt", "string");
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

/** Write a tape file atomically enough for tests: full content, single write. */
export async function saveTape(path: string, tape: Tape): Promise<void> {
  await writeFile(path, serializeTape(tape), "utf8");
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
