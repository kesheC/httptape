import { loadTape } from "./tape.js";
import { findMatch, describeRequest } from "./match.js";
import { NoMatchError } from "./errors.js";
import type { ReplayOptions, ReplayResult, Tape } from "./types.js";

/**
 * Answer one request from the tape at `options.tapePath`. Default mode is
 * `"strict"`: an unmatched request throws {@link NoMatchError} naming the
 * method and URL, which is the signal that the tape and the code disagree
 * and a human should look. `"stub"` never throws and never touches network.
 */
export async function replay(
  request: { method: string; url: string; body?: string | null },
  options: ReplayOptions,
): Promise<ReplayResult> {
  const mode = options.mode ?? "strict";
  const tape: Tape = await loadTape(options.tapePath);
  const played = replayState.playedPerTape.get(options.tapePath) ?? new Set<number>();

  const found = findMatch(tape.interactions, request, {
    matchBody: options.matchBody,
    played,
  });

  if (found) {
    played.add(found.index);
    replayState.playedPerTape.set(options.tapePath, played);
    return {
      matched: true,
      status: found.interaction.status,
      headers: { ...found.interaction.responseHeaders },
      body: found.interaction.responseBody ?? "",
      interaction: found.interaction,
    };
  }

  const described = describeRequest(request);
  if (mode === "stub") {
    return {
      matched: false,
      status: 599,
      headers: { "x-httptape": "stub" },
      body: "",
    };
  }
  if (mode === "strict") {
    const message = "no recorded interaction for " + described + " in " + options.tapePath;
    throw new NoMatchError(message, { method: request.method, url: request.url });
  }
  // mode === "record": perform the exchange for real and append it.
  const { record } = await import("./record.js");
  const interaction = await record(request.url, {
    name: tape.name,
    outPath: options.tapePath,
    method: request.method,
    body: request.body ?? undefined,
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
    replayState.playedPerTape.delete(tapePath);
  }
}

const replayState: { playedPerTape: Map<string, Set<number>> } = {
  playedPerTape: new Map(),
};
