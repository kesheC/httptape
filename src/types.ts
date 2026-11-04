/**
 * The tape format. A tape is a JSON file holding an ordered list of
 * {@link Interaction}s captured from real HTTP exchanges. Everything the
 * replayer needs to match a request and answer with the recorded response is
 * in the file - no code, no closures, diffable and hand-editable.
 */
export const TAPE_FORMAT_VERSION = 1 as const;

/** The tape format version this package writes and reads. */
export type TapeFormatVersion = typeof TAPE_FORMAT_VERSION;

/** HTTP method, uppercased on capture. */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

const METHODS: readonly HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

/** True when `value` is one of the seven methods httptape records. */
export function isHttpMethod(value: string): value is HttpMethod {
  return (METHODS as readonly string[]).includes(value);
}

/**
 * One recorded request/response pair. `recordedAt` is an ISO-8601 timestamp
 * taken when the exchange happened; it exists so a human reading the tape can
 * order and age the entries, never for matching.
 */
export interface Interaction {
  /** Uppercase method of the recorded request. */
  method: HttpMethod;
  /** Absolute URL of the recorded request, as requested (no normalization). */
  url: string;
  /** Request headers as sent; multiple values per name are joined with ", ". */
  requestHeaders: Record<string, string>;
  /** Request body, captured as text when it decodes as UTF-8, else null. */
  requestBody: string | null;
  /** Numeric HTTP status of the recorded response. */
  status: number;
  /** Response headers as received; multiple values per name are joined with ", ". */
  responseHeaders: Record<string, string>;
  /** Response body as text (null when the capture could not decode it). */
  responseBody: string | null;
  /** ISO-8601 timestamp of the capture. */
  recordedAt: string;
}

/**
 * A recorded tape: the on-disk unit of record/replay. Write it once with
 * {@link record}, check it in, replay it forever with {@link replay}.
 */
export interface Tape {
  /** Format tag; readers reject files whose version they do not understand. */
  formatVersion: TapeFormatVersion;
  /** Human-readable name; also the default file stem (`<name>.tape.json`). */
  name: string;
  /** ISO-8601 timestamp of when recording started. */
  recordedAt: string;
  /** The recorded exchanges, in capture order. */
  interactions: Interaction[];
}

/** How a replayer treats a request that matches no recorded interaction. */
export type ReplayMode =
  /** Fail the call: a missing interaction is a test bug. Default. */
  | "strict"
  /** Record the exchange for real and append it to the tape. */
  | "record"
  /** Serve a deterministic empty 599 response, so a run never touches network. */
  | "stub";

/** Options for {@link replay}. All fields optional except `tapePath`. */
export interface ReplayOptions {
  /** Path of the tape file to load. Required. */
  tapePath: string;
  /** What to do with unmatched requests. Default `"strict"`. */
  mode?: ReplayMode;
  /** Match request bodies too, not just method and URL. Default false. */
  matchBody?: boolean;
}

/** What a single replayed call produced. */
export interface ReplayResult {
  /** True when the response came from the tape; false for stubs. */
  matched: boolean;
  /** HTTP status to hand to the caller. */
  status: number;
  /** Response headers from the tape (or the stub). */
  headers: Record<string, string>;
  /** Response body from the tape (or the stub). */
  body: string;
  /** The tape interaction that matched, when `matched` is true. */
  interaction?: Interaction;
}

/** Options for {@link record}. HTTP request fields come from http.RequestOptions. */
export interface RecordOptions {
  /** Tape name (becomes `name` and the default file stem). */
  name: string;
  /** Request body to send; null/undefined means no body. */
  body?: string | null;
  /** Where to write the tape file. Default `<name>.tape.json` in cwd. */
  outPath?: string;
  /** Extra headers to strip from captures (case-insensitive names). */
  redactHeaders?: string[];
}

/** The subset of `http.ClientRequest` options httptape captures. */
export interface CapturedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
}
