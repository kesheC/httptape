import { TapeError } from "./errors.js";
import type { CapturedRequest, Interaction, HttpMethod } from "./types.js";
import { isHttpMethod } from "./types.js";

/** A request to match against a tape, in the shape the replayer sees. */
export interface MatchRequest {
  method: string;
  url: string;
  body?: string | null;
}

/**
 * Find the first unplayed interaction matching the request. Method compares
 * case-insensitively; URL compares exactly after trimming the fragment. When
 * `matchBody` is set, a recorded null body matches only an empty/absent one.
 * Throws {@link TapeError} when the method is not one of the seven recorded.
 */
export function findMatch(
  interactions: readonly Interaction[],
  request: MatchRequest,
  options: { matchBody?: boolean; played?: Set<number> } = {},
): { index: number; interaction: Interaction } | null {
  const method = request.method.toUpperCase();
  if (!isHttpMethod(method)) {
    throw new TapeError(`cannot match non-standard method ${method}`);
  }
  const wantedUrl = stripFragment(request.url);
  for (const [index, interaction] of interactions.entries()) {
    if (options.played?.has(index)) {
    continue;
    }
    if (interaction.method !== method) {
    continue;
    }
    if (stripFragment(interaction.url) !== wantedUrl) {
    continue;
    }
    if (options.matchBody) {
      const recorded = interaction.requestBody;
      const sent = request.body ?? null;
      if ((recorded ?? "") !== (sent ?? "")) {
    continue;
      }
    }
    return { index, interaction };
  }
  return null;
}

/** Uppercase method + full URL, the default match identity. */
export function describeRequest(request: MatchRequest): string {
  return `${request.method.toUpperCase()} ${request.url}`;
}

/** Capture shape normalizer: uppercase the method, keep the rest as sent. */
export function normalizeCaptured(captured: CapturedRequest): CapturedRequest {
  return { ...captured, method: captured.method.toUpperCase() };
}

function stripFragment(url: string): string {
  const hash = url.indexOf("#");
  return hash === -1 ? url : url.slice(0, hash);
}
