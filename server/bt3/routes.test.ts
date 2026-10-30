import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPasses } from "./pass";
import { createBt3, GAME_FILES, MANIFEST, PIECE } from "./routes";

const PAGE_DIR = join(import.meta.dir, "..", "..", "plugins", "bt3", "page");
const passes = createPasses("secret");
let dir: string;
let bt3: ReturnType<typeof createBt3>;
let pass: string;
// A small stand-in for the disc image: two whole pieces and a shorter last one.
const SIZE = 2 * PIECE + 1234;
const iso = new Uint8Array(SIZE).map((_, i) => (i * 7 + (i >> 20)) & 0xff);

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "bt3-routes-"));
  await writeFile(join(dir, "disc.iso"), iso);
  await mkdir(join(dir, "build"));
  for (const f of [...GAME_FILES, "bt3_node.js", "telemetry.log"]) await writeFile(join(dir, "build", f), `file ${f}`);
  await mkdir(join(dir, "work"));
  await writeFile(join(dir, "work", "secret.txt"), "intermediate");
  bt3 = createBt3({ enabled: true, dir, pageDir: PAGE_DIR, passes });
  pass = await passes.issue("Ana#1", "Ana");
});
afterAll(() => rm(dir, { recursive: true, force: true }));

const get = (path: string, init?: RequestInit, on = bt3) => on.handle(new Request(`http://localhost${path}`, init)) as Promise<Response>;
const p = (rest: string) => `/plugins/bt3/p/${pass}/${rest}`;

test("manifest and icon are public; the rest needs a valid pass", async () => {
  const manifest = await get("/plugins/bt3/hypemeet-plugin.json");
  expect(await manifest.json()).toEqual(MANIFEST);
  expect((await get("/plugins/bt3/icon.svg")).headers.get("content-type")).toBe("image/svg+xml");
  expect((await get("/plugins/bt3/")).status).toBe(403);
  const forged = `${pass.split(".")[0]}.AAAA`;
  for (const path of [`/plugins/bt3/p/${forged}/`, `/plugins/bt3/p/${forged}/status`, `/plugins/bt3/p/${forged}/game/disc/00000.bin`, "/plugins/bt3/p/nopass/status"])
    expect([403, 404]).toContain((await get(path)).status);
  expect((await get(`/plugins/bt3/p/${forged}/game/index.html`)).status).toBe(403);
});

test("the page, with the sandbox and CORS headers; the trailing slash is added", async () => {
  const res = await get(p(""));
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("Budokai Tenkaichi 3");
  const csp = res.headers.get("content-security-policy")!;
  expect(csp).toStartWith("sandbox allow-scripts allow-forms allow-popups allow-downloads;");
  expect(csp).not.toContain("allow-same-origin");
  expect(csp).toContain("frame-ancestors 'self' https://discord.com https://*.discord.com https://*.discordsays.com");
  expect(res.headers.get("access-control-allow-origin")).toBe("*");
  expect(res.headers.get("cache-control")).toBe("no-cache");
  const bare = await get(`/plugins/bt3/p/${pass}`);
  expect(bare.status).toBe(301);
  expect(bare.headers.get("location")).toBe(`/plugins/bt3/p/${pass}/`);
  expect((await get(p("game"))).headers.get("location")).toBe(`/plugins/bt3/p/${pass}/game/`);
  // Preflight of the upload's PUT.
  const pre = await get(p("upload"), { method: "OPTIONS" });
  expect(pre.status).toBe(204);
  expect(pre.headers.get("access-control-allow-methods")).toContain("PUT");
});

test("only the game's listed files, with their types", async () => {
  expect(await (await get(p("game/"))).text()).toBe("file index.html");
  const wasm = await get(p("game/bt3-jspi.wasm"));
  expect(wasm.headers.get("content-type")).toBe("application/wasm");
  expect(wasm.headers.get("access-control-allow-origin")).toBe("*");
  expect((await get(p("game/net.js"))).headers.get("content-type")).toStartWith("text/javascript");
  for (const f of ["game/bt3_node.js", "game/telemetry.log", "game/../work/secret.txt", "game/%2e%2e/work/secret.txt", "game/disc.iso", "disc.iso", "work/secret.txt"])
    expect((await get(p(f))).status).toBe(404);
});

test("the disc in 1 MiB pieces, read from the image; the last one is shorter", async () => {
  expect(await (await get(p("game/disc/index.json"))).json()).toEqual({ size: SIZE, piece: PIECE });
  for (const [n, from, to] of [[0, 0, PIECE], [1, PIECE, 2 * PIECE], [2, 2 * PIECE, SIZE]] as const) {
    const res = await get(p(`game/disc/0000${n}.bin`));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body.length).toBe(to - from);
    expect(Buffer.from(body).equals(Buffer.from(iso.subarray(from, to)))).toBe(true);
  }
  expect((await get(p("game/disc/00003.bin"))).status).toBe(404);
  expect((await get(p("game/disc/1.bin"))).status).toBe(404);
});

test("status, net endpoints that keep nothing, and WebSockets only by upgrade", async () => {
  expect(await (await get(p("status"))).json()).toEqual({ state: "ready" });
  for (const f of ["game/net/stat", "game/net/log", "game/telemetry"]) expect((await get(p(f), { method: "POST", body: "{}" })).status).toBe(204);
  expect((await get(p("game/net/ws?room=ABCD&role=host"))).status).toBe(426);
  expect((await get(p("game/net/ws?room=bad&role=host"))).status).toBe(400);
});

test("BT3_PLUGIN=0: everything 404", async () => {
  const off = createBt3({ enabled: false, dir, pageDir: PAGE_DIR, passes });
  for (const path of ["/plugins/bt3/hypemeet-plugin.json", p(""), p("game/index.html")]) expect((await get(path, undefined, off)).status).toBe(404);
});
