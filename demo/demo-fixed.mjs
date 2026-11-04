// Record one exchange against a throwaway local server, then replay it
// after the server is gone. Run: node demo/demo-fixed.mjs
import { createServer } from "node:http";
import { record } from "../dist/record.js";
import { replay } from "../dist/replay.js";
import { NoMatchError } from "../dist/errors.js";

const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ hello: "world" }));
});
server.listen(49678, "127.0.0.1", async () => {
  const base = "http://127.0.0.1:49678";
  await record(base + "/greet", { name: "demo", outPath: "demo/demo.tape.json" });
  server.close();
  const r1 = await replay({ method: "GET", url: base + "/greet" }, { tapePath: "demo/demo.tape.json" });
  console.log("replayed:", r1.status, r1.body);
  try {
    await replay({ method: "DELETE", url: base + "/greet" }, { tapePath: "demo/demo.tape.json" });
  } catch (error) {
    console.log("unmatched:", error instanceof NoMatchError ? error.message : String(error));
  }
});