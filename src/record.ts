import { request as httpRequest, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { URL } from "node:url";
import { loadTape, saveTape, emptyTape } from "./tape.js";
import type { Interaction, HttpMethod, RecordOptions } from "./types.js";
import { isHttpMethod } from "./types.js";
import { stripUserInfo } from "./match.js";

const DEFAULT_REDACT = ["authorization", "cookie", "set-cookie", "proxy-authorization"];

/**
 * Header names matching this pattern carry credentials in practice
 * (x-api-key, x-auth-token, session-token, client-secret, ...), so they
 * are redacted on top of the explicit {@link DEFAULT_REDACT} list.
 */
const CREDENTIAL_PATTERN = /(?:auth|key|token|secret|password|credential|signature)/i;

/** Default wall-clock cap for one recorded exchange. */
const DEFAULT_RECORD_TIMEOUT_MS = 30_000;

/**
 * Decode a captured body as UTF-8 text, or return null when the bytes are
 * not valid UTF-8 (the tape promises text, never a lossy mojibake rewrite).
 */
export function decodeBody(bytes: Buffer): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Perform a real HTTP request and append the exchange to the tape file at
 * `options.outPath` (default `<name>.tape.json` in the current directory).
 * The tape is read, appended, and written on every call, so recording is
 * safe to interleave with other writers of the same file only when each
 * `record` call is awaited before the next starts.
 */
export async function record(
  url: string,
  options: RecordOptions & RequestOptions = { name: "tape" },
): Promise<Interaction> {
  const name = options.name ?? "tape";
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new Error("httptape record needs a non-empty tape name");
  }
  const parsed = new URL(url);
  const transport = parsed.protocol === "https:" ? httpsRequest : httpRequest;
  const method = (options.method ?? "GET").toUpperCase();
  if (!isHttpMethod(method)) {
    throw new Error(`httptape records the seven standard methods, not ${method}`);
  }
  // RFC 7231: a HEAD request carries no body. Sending one is undefined, so
  // recording drops it instead of storing a body the replay can never match.
  const rawBody: string | Buffer | null =
    method === "HEAD" || options.body == null ? null : options.body;
  // A Buffer is sent as raw bytes but stored as text-or-null: the tape
  // promises UTF-8 text, never a lossy mojibake rewrite (decodeBody).
  const requestBody: string | null =
    rawBody == null || typeof rawBody === "string" ? rawBody : decodeBody(rawBody);
  const response = await perform(
    transport,
    parsed,
    options,
    rawBody,
    options.timeoutMs ?? DEFAULT_RECORD_TIMEOUT_MS,
  );

  const tapePath = options.outPath ?? `${options.name}.tape.json`;
  const tape = await loadTapeSafe(tapePath, options.name);

  const interaction: Interaction = {
    method: method as HttpMethod,
    url: stripUserInfo(url),
    requestHeaders: redact(response.sentHeaders, options.redactHeaders),
    requestBody,
    status: response.status,
    responseHeaders: redact(response.headers, options.redactHeaders),
    responseBody: response.body,
    recordedAt: new Date().toISOString(),
  };
  tape.interactions.push(interaction);
  await saveTape(tapePath, tape);
  return interaction;
}

interface Performed {
  status: number;
  headers: Record<string, string>;
  sentHeaders: Record<string, string>;
  body: string | null;
}

function perform(
  transport: typeof httpRequest,
  parsed: URL,
  options: RequestOptions,
  body: string | Buffer | null,
  timeoutMs: number,
): Promise<Performed> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(
      () =>
        settle(() => {
          const error = new Error(
            `httptape record timed out after ${timeoutMs}ms waiting for ${parsed.host}${parsed.pathname}`,
          );
          req.destroy(error);
          reject(error);
        }),
      timeoutMs,
    );
    const req = transport(parsed, options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("error", (error: Error) => settle(() => reject(error)));
      res.on("end", () =>
        settle(() =>
          resolve({
            status: res.statusCode ?? 0,
            headers: flattenHeaders(res.headers),
            sentHeaders: flattenHeaders(req.getHeaders()),
            body: decodeBody(Buffer.concat(chunks)),
          }),
        ),
      );
    });
    req.on("error", (error: Error) => settle(() => reject(error)));
    if (body != null) {
      req.write(body);
    }
    req.end();
  });
}

async function loadTapeSafe(path: string, name: string) {
  try {
    return await loadTape(path);
  } catch (error) {
    // A missing file is the normal start of a recording; anything else is real.
    const cause = error as NodeJS.ErrnoException;
    if (cause.code === "ENOENT") {
      return emptyTape(name);
    }
    throw error;
  }
}

function flattenHeaders(source: Record<string, string | number | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) {
    continue;
    }
    out[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  return out;
}

function redact(
  headers: Record<string, string>,
  extra: string[] | undefined,
): Record<string, string> {
  const banned = new Set([...DEFAULT_REDACT, ...(extra ?? []).map((h) => h.toLowerCase())]);
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] = banned.has(name.toLowerCase()) || CREDENTIAL_PATTERN.test(name) ? "[REDACTED]" : value;
  }
  return out;
}