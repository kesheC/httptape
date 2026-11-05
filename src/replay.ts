import { resolve } from "node:path";
import { loadTape, emptyTape } from "./tape.js";
import { TapeError } from "./errors.js";
import { findMatch, describeRequest } from "./match.js";
import { NoMatchError } from "./errors.js";
import type { ReplayOptions, ReplayResult, Tape } from "./types.js";

/**
 * Consumption key for a tape path: resolved absolute, lowercased on
 * filesystems where the same file answers to different letter cases
 * (Windows, macOS), so "./A.json" and "a.json" share one played Set.
 */
export function tapeKey(tapePath: string): string {
  const abs = resolve(tapePath);
  return process.platform === "win32" || process.platform === "darwin" ? abs.toLowerCase() : abs;
}

/**
 * Answer one request from the tape at `options.tapePath`. Default mode is
 * `"strict"`: an unmatched request throws {@link NoMatchError} naming the
 * method and URL, which is the signal that the tape and the code disagree
 * and a human should look. `"stub"` never throws and never touches network.
 * `"record"` performs a miss for real and appends it; that path is not
 * concurrency-safe for one tape - concurrent record calls on the same tape
 * race a read-modify-write, so serialize them (or use one tape per writer).
 */
export async function replay(
  request: { method: string; url: string; body?: string | null; headers?: Record<string, string> },
  options: ReplayOptions,
): Promise<ReplayResult> {
  const mode = options.mode ?? "strict";
  const tape: Tape = await loadTapeSafe(options.tapePath, mode);
  // Key the per-tape consumption state by the resolved absolute path, so
  // "./a.tape.json" and "a.tape.json" share one Set instead of each silently
  // replaying the first interaction.
  const key = tapeKey(options.tapePath);
  const played = replayState.playedPerTape.get(key) ?? new Set<number>();

  let found: { index: number; interaction: (typeof tape.interactions)[number] } | null = null;
  try {
    found = findMatch(tape.interactions, request, {
      matchBody: options.matchBody,
      played,
    });
  } catch (error) {
    // A method a tape can never hold (TRACE, CONNECT, ...) must read as "no
    // match", not as a crash - in stub mode that means the 599 contract, in
    // strict mode a NoMatchError.
    if (!(error instanceof TapeError)) {
      throw error;
    }
  }

  if (mode === "stub") {
    // The stub contract (README): a request the tape can answer is answered
    // from the tape; anything else gets a deterministic 599, and network is
    // never touched in either case.
    if (found) {
      return {
        matched: true,
        status: found.interaction.status,
        headers: { ...found.interaction.responseHeaders },
        body: found.interaction.responseBody ?? "",
        interaction: found.interaction,
      };
    }
    return {
      matched: false,
      status: 599,
      headers: { "x-httptape": "stub" },
      body: "",
    };
  }

  if (found) {
    played.add(found.index);
    replayState.playedPerTape.set(key, played);
    return {
      matched: true,
      status: found.interaction.status,
      headers: { ...found.interaction.responseHeaders },
      body: found.interaction.responseBody ?? "",
      interaction: found.interaction,
    };
  }

  const described = describeRequest(request);
  if (mode === "strict") {
    const message = "no recorded interaction for " + described + " in " + options.tapePath;
    throw new NoMatchError(message, { method: request.method, url: request.url });
  }
  // mode === "record": perform the exchange for real and append it. Headers
  // come from the live request shape first, then the options object, so a
  // caller can get authenticated requests onto the tape.
  const { record } = await import("./record.js");
  const interaction = await record(request.url, {
    name: tape.name,
    outPath: options.tapePath,
    method: request.method,
    body: request.body ?? undefined,
    headers: request.headers ?? options.headers,
  });
  return {
    matched: true,
    status: interaction.status,
    headers: { ...interaction.responseHeaders },
    body: interaction.responseBody ?? "",
    interaction,
  };
}

/** Forget which interactions have been consumed, so a tape can replay again. */
export function resetReplay(tapePath?: string): void {
  if (tapePath === undefined) {
    replayState.playedPerTape.clear();
  } else {
    replayState.playedPerTape.delete(tapeKey(tapePath));
  }
}

const replayState: { playedPerTape: Map<string, Set<number>> } = {
  playedPerTape: new Map(),
};

/**
 * Load the tape for a replay call. A missing file is only survivable in
 * record mode - it is the normal start of a new recording. Strict and stub
 * modes point at a tape that should exist, so a typo must surface.
 */
async function loadTapeSafe(path: string, mode: ReplayOptions["mode"]): Promise<Tape> {
  try {
    return await loadTape(path);
  } catch (error) {
    const cause = error as NodeJS.ErrnoException;
    if (mode === "record" && cause.code === "ENOENT") {
      return emptyTape("tape");
    }
    throw error;
  }
}