import { request as httpRequest, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { URL } from "node:url";
import { loadTape, saveTape, emptyTape } from "./tape.js";
import type { Interaction, HttpMethod, RecordOptions } from "./types.js";
import { isHttpMethod } from "./types.js";

const DEFAULT_REDACT = ["authorization", "cookie", "set-cookie", "proxy-authorization"];

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
  const parsed = new URL(url);
  const transport = parsed.protocol === "https:" ? httpsRequest : httpRequest;
  const method = (options.method ?? "GET").toUpperCase();
  if (!isHttpMethod(method)) {
    throw new Error(`httptape records the seven standard methods, not ${method}`);
  }
  const requestBody = options.body == null ? null : String(options.body);
  const response = await perform(transport, parsed, options, requestBody);

  const tapePath = options.outPath ?? `${options.name}.tape.json`;
  const tape = await loadTapeSafe(tapePath, options.name);

  const interaction: Interaction = {
    method: method as HttpMethod,
    url,
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
  body: string;
}

function perform(
  transport: typeof httpRequest,
  parsed: URL,
  options: RequestOptions,
  body: string | null,
): Promise<Performed> {
  return new Promise((resolve, reject) => {
    const req = transport(parsed, options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks);
        resolve({
          status: res.statusCode ?? 0,
          headers: flattenHeaders(res.headers),
          sentHeaders: flattenHeaders(req.getHeaders()),
          body: raw.toString("utf8"),
        });
      });
    });
    req.on("error", reject);
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
    out[name] = banned.has(name.toLowerCase()) ? "[REDACTED]" : value;
  }
  return out;
}
