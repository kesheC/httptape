# httptape

Record real HTTP exchanges into plain JSON tapes, then replay them in tests — no network, no mocks to hand-write, no runtime dependencies.

A tape is a diffable JSON file: you can read it, review it in a pull request, and edit it by hand. Tests answer from the tape in milliseconds and stay deterministic forever.

## Why

- **Record once, replay forever.** Point `record()` at a running service once; every later test run reads the tape file.
- **Strict mode is the point.** An unmatched request throws `NoMatchError` naming method and URL — a tape that drifts from the code fails loudly instead of silently passing with fake data.
- **Zero runtime dependencies.** The whole package is `node:http`, `node:fs`, and plain TypeScript.
- **Redaction built in.** `authorization`, `cookie`, `set-cookie`, and `proxy-authorization` headers are captured as `[REDACTED]`.

## Install

```bash
$ npm install httptape

added 1 package, and audited 2 packages in …
```

## Quickstart

Record one exchange against a real server (here: a tiny `node:http` server on a fixed port), then replay it after the server is gone:

```js
// demo-fixed.mjs
import { createServer } from "node:http";
import { record } from "httptape";
import { replay } from "httptape";

const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ hello: "world" }));
});
server.listen(49678, "127.0.0.1", async () => {
  const base = "http://127.0.0.1:49678";
  await record(base + "/greet", { name: "demo" });
  server.close();
  const r1 = await replay({ method: "GET", url: base + "/greet" }, { tapePath: "demo.tape.json" });
  console.log("replayed:", r1.status, r1.body);
});
```

Running it once records the tape and immediately proves the replay works:

```bash
$ rm -f demo/demo.tape.json
$ node demo/demo-fixed.mjs
replayed: 200 {"hello":"world"}
unmatched: no recorded interaction for DELETE http://127.0.0.1:49678/greet in demo/demo.tape.json
```

The tape it wrote:

```json
{
  "formatVersion": 1,
  "name": "demo",
  "recordedAt": "2026-11-04T18:37:04.947Z",
  "interactions": [
    {
      "method": "GET",
      "url": "http://127.0.0.1:49678/greet",
      "requestHeaders": {
        "host": "127.0.0.1:49678"
      },
      "requestBody": null,
      "status": 200,
      "responseHeaders": {
        "content-type": "application/json",
        "date": "Wed, 04 Nov 2026 …GMT",
        "connection": "keep-alive",
        "keep-alive": "timeout=5",
        "transfer-encoding": "chunked"
      },
      "responseBody": "{\"hello\":\"world\"}",
      "recordedAt": "2026-11-04T18:37:04.947Z"
    }
  ]
}
```

## The CLI

`httptape inspect` validates tape files without writing any code:

```bash
$ npm run build -s
$ node dist/cli.js inspect demo/demo.tape.json
demo/demo.tape.json: 1 interactions, format v1 (demo)
```

With `--json` for scripts:

```bash
$ node dist/cli.js inspect --json demo/demo.tape.json
[
  {
    "path": "demo/demo.tape.json",
    "ok": true,
    "name": "demo",
    "interactions": 1,
    "formatVersion": 1
  }
]
```

Help:

```bash
$ npm run build -s
$ node dist/cli.js --help
httptape - record and replay HTTP interactions as JSON tapes

Usage:
  httptape inspect [--json] <tape.json>...   validate tapes and count interactions
  httptape --help | --version

Library use: import { record, replay } from the npm package in your test code.

Modes:
  strict  unmatched request throws NoMatchError (default)
  stub    unmatched request gets a deterministic 599, no network
  record  unmatched request performs the real exchange and appends it

Exit codes: 0 ok, 1 usage or invalid tape.
```

## Replay modes

| mode | unmatched request | touches network |
| --- | --- | --- |
| `strict` (default) | throws `NoMatchError` | never |
| `stub` | deterministic `599` with `x-httptape: stub` | never |
| `record` | performs the real exchange, appends it to the tape | only for misses |

Strict mode failing looks like this — the error names the method and URL so you know exactly which interaction is missing:

```bash
$ rm -f demo/demo.tape.json && node demo/demo-fixed.mjs
replayed: 200 {"hello":"world"}
unmatched: no recorded interaction for DELETE http://127.0.0.1:49678/greet in demo/demo.tape.json
```

## Library reference

### `record(url, options)`

Performs the request for real and appends the exchange to the tape file (`options.outPath`, default `<name>.tape.json`). Options: `name` (required), `method`, `body`, `headers`, `outPath`, `redactHeaders` (extra header names to redact, case-insensitive).

### `replay(request, options)`

Answers one request from the tape. Options: `tapePath` (required), `mode` (`strict` / `stub` / `record`), `matchBody` (also compare request bodies; default false). Returns `{ matched, status, headers, body, interaction }`.

### `resetReplay(tapePath?)`

Forgets which interactions have been consumed, so the same tape can serve a second test. Without an argument, resets every tape.

### Tape format

`formatVersion` is 1. Readers reject files with a different version rather than guessing. Validation checks structure (every interaction needs method, url, headers, bodies, status, timestamps); matching checks the method vocabulary (the seven standard methods).

## Matching rules

- Method compares case-insensitively; URL compares exactly, ignoring the `#fragment`.
- Interactions are consumed in tape order: the second identical request gets the second matching entry. `resetReplay()` rewinds this.
- With `matchBody: true`, a recorded `null` body matches only an absent or empty request body.

## Development

```bash
$ npm ci
$ npm run build -s
$ npm test 2>&1 | grep -E 'Test Files|Tests '
 Test Files  5 passed (5)
      Tests  46 passed (46)
```

Coverage gate (floors 80/70/85/80 in `vitest.config.ts`):

```bash
$ npm run coverage 2>&1 | grep 'All files' | sed 's/ *$//'
All files  |   94.11 |     87.7 |   96.66 |   94.59 |
```

## API

| export | what it does |
| --- | --- |
| `record(url, opts)` | real request → append to tape |
| `replay(req, opts)` | answer from tape |
| `resetReplay(path?)` | rewind consumed interactions |
| `loadTape` / `saveTape` / `validateTape` / `emptyTape` | tape file I/O |
| `findMatch` / `describeRequest` | matching internals, exported for tools |
| `TapeError`, `NoMatchError` | error types |

## License

[MIT](LICENSE)

---

## 中文说明

`httptape` 把真实的 HTTP 交互录制成纯 JSON 磁带文件，测试时从磁带回放——不联网、不手写 mock、零运行时依赖。

磁带是可 diff 的 JSON：能读、能进 PR 审查、能手改。测试从磁带毫秒级应答，永远确定性。

### 为什么

- **录一次，永远回放。** `record()` 对真实服务录一遍；之后每次测试都读磁带文件。
- **strict 模式是核心。** 未匹配的请求抛 `NoMatchError`，报出方法与 URL——磁带与代码漂移时大声失败，而不是拿假数据悄悄通过。
- **零运行时依赖。** 整个包只有 `node:http`、`node:fs` 与纯 TypeScript。
- **内置脱敏。** `authorization`、`cookie`、`set-cookie`、`proxy-authorization` 头录制为 `[REDACTED]`。

### 安装与快速上手

```bash
$ npm install httptape

added 1 package, and audited 2 packages in …
```

录制一次（对着本地固定端口起的小服务器），服务器关掉后回放：

```bash
$ rm -f demo/demo.tape.json && node demo/demo-fixed.mjs
replayed: 200 {"hello":"world"}
unmatched: no recorded interaction for DELETE http://127.0.0.1:49678/greet in demo/demo.tape.json
```

写出的磁带：

```json
{
  "formatVersion": 1,
  "name": "demo",
  "recordedAt": "2026-11-04T18:37:04.947Z",
  "interactions": [
    {
      "method": "GET",
      "url": "http://127.0.0.1:49678/greet",
      "requestBody": null,
      "status": 200,
      "responseBody": "{\"hello\":\"world\"}",
      "recordedAt": "2026-11-04T18:37:04.947Z"
    }
  ]
}
```

### 回放模式

| 模式 | 未匹配请求 | 联网 |
| --- | --- | --- |
| `strict`（默认） | 抛 `NoMatchError` | 永不 |
| `stub` | 确定性 `599`，带 `x-httptape: stub` | 永不 |
| `record` | 真实执行并追加进磁带 | 仅未匹配时 |

### CLI

```bash
$ npm run build -s
$ node dist/cli.js inspect demo/demo.tape.json
demo/demo.tape.json: 1 interactions, format v1 (demo)
```

### 开发

```bash
$ npm ci && npm run build -s
$ npm test 2>&1 | grep -E 'Test Files|Tests '
 Test Files  5 passed (5)
      Tests  46 passed (46)
```

覆盖率闸门（`vitest.config.ts` 中下限 80/70/85/80）：全文件 94.11 语句 / 87.7 分支 / 96.66 函数 / 94.59 行。

### 许可

[MIT](LICENSE)
