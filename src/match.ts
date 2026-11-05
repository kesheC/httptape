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
 * case-insensitively on both sides (a hand-edited lowercase tape entry still
 * matches); URL compares through {@link normalizeUrl} (fragment and userinfo
 * stripped from both sides). When `matchBody` is set, a recorded null body
 * matches only an empty/absent one. Throws {@link TapeError} when the method
 * is not one of the seven recorded.
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
  const wantedUrl = normalizeUrl(request.url);
  for (const [index, interaction] of interactions.entries()) {
    if (options.played?.has(index)) {
    continue;
    }
    if (interaction.method.toUpperCase() !== method) {
    continue;
    }
    if (normalizeUrl(interaction.url) !== wantedUrl) {
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

/**
 * Match identity for URLs: strip the fragment, then strip userinfo
 * (`https://user:pass@host/...`). Recorded URLs have userinfo removed at
 * capture time (credentials must not persist on disk), while a live request
 * may still carry it - normalizing both sides lets the two match.
 */
export function normalizeUrl(url: string): string {
  return stripUserInfo(stripFragment(url));
}

/**
 * Remove userinfo from a URL string. Credentials embedded in the URL must
 * not outlive the session on disk, so the recorder strips them before the
 * interaction is written to a tape. Unparseable input is returned as-is.
 */
export function stripUserInfo(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username === "" && parsed.password === "") {
      return url;
    }
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * URL safe for error surfaces: origin + path only. The query string is
 * omitted so credentials passed as `?token=...` never leak into exception
 * text or logs, and userinfo is stripped as well.
 */
export function safeRequestUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "<url withheld>";
  }
}

/** Uppercase method + origin + path: an error-safe request identity. */
export function describeRequest(request: MatchRequest): string {
  return `${request.method.toUpperCase()} ${safeRequestUrl(request.url)}`;
}

/** Capture shape normalizer: uppercase the method, keep the rest as sent. */
export function normalizeCaptured(captured: CapturedRequest): CapturedRequest {
  return { ...captured, method: captured.method.toUpperCase() };
}

function stripFragment(url: string): string {
  const hash = url.indexOf("#");
  return hash === -1 ? url : url.slice(0, hash);
}