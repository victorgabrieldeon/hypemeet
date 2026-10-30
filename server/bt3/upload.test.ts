import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pass } from "./pass";
import { createDiscStore, QUIET_MS } from "./upload";

const ana: Pass = { id: "Ana#1", name: "Ana", exp: Infinity };
const bia: Pass = { id: "Bia#2", name: "Bia", exp: Infinity };
const bytes = (n: number, fill: number) => new Uint8Array(n).fill(fill);

let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  dirs = [];
});

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "bt3-upload-"));
  dirs.push(dir);
  let clock = 1_000_000;
  const store = createDiscStore(dir, { now: () => clock, min: 10, max: 100, maxPiece: 8 });
  return { dir, store, advance: (ms: number) => (clock += ms), now: () => clock };
}

test("in pieces, each from where the last ended; complete → disc.iso, queued for the builder", async () => {
  const { dir, store, now } = await setup();
  expect(await store.status(ana)).toEqual({ state: "empty" });
  expect(await store.progress()).toEqual({ received: 0, size: null, done: false });
  expect(await store.put(ana, 0, 20, bytes(8, 1))).toEqual({ ok: true, received: 8, done: false });
  expect(await store.status(bia)).toEqual({ state: "uploading", received: 8, size: 20, by: "Ana", mine: false, stale: false });
  expect(await store.status(ana)).toMatchObject({ mine: true });
  expect(await store.put(ana, 8, 20, bytes(8, 2))).toEqual({ ok: true, received: 16, done: false });
  expect(await store.put(ana, 16, 20, bytes(4, 3))).toEqual({ ok: true, received: 20, done: true });
  const iso = await readFile(join(dir, "disc.iso"));
  expect([...iso]).toEqual([...bytes(8, 1), ...bytes(8, 2), ...bytes(4, 3)]);
  expect(await stat(join(dir, "upload")).catch(() => null)).toBeNull();
  expect(await store.progress()).toMatchObject({ done: true });
  // The builder hasn't answered yet: offline; once it's alive, the image waits in line.
  expect(await store.status(ana)).toEqual({ state: "offline" });
  await writeFile(join(dir, "status.json"), JSON.stringify({ at: now(), state: "idle" }));
  expect(await store.status(ana)).toEqual({ state: "queued" });
  // A second upload: the server already has it.
  expect(await store.put(bia, 0, 20, bytes(8, 1))).toMatchObject({ ok: false, status: 409, code: "done" });
});

test("a wrong offset is 409 with the right one; picking up after a drop", async () => {
  const { store } = await setup();
  await store.put(ana, 0, 20, bytes(8, 1));
  expect(await store.put(ana, 0, 20, bytes(8, 1))).toEqual({ ok: false, status: 409, code: "order", error: "Fora de ordem", received: 8 });
  expect(await store.put(ana, 12, 20, bytes(8, 1))).toMatchObject({ status: 409, received: 8 });
  // (the connection dropped: the page asks where the server is and goes on)
  expect(await store.progress()).toEqual({ received: 8, size: 20, done: false });
  expect(await store.put(ana, 8, 20, bytes(8, 2))).toMatchObject({ ok: true, received: 16 });
  // Past the end of the file.
  expect(await store.put(ana, 16, 20, bytes(8, 2))).toMatchObject({ ok: false, status: 400 });
});

test("one upload at a time: another pass gets 409 until it went quiet, then takes over", async () => {
  const { store, advance } = await setup();
  await store.put(ana, 0, 20, bytes(8, 1));
  expect(await store.put(bia, 8, 20, bytes(8, 2))).toMatchObject({ ok: false, status: 409, code: "busy", error: "Ana está enviando a ISO" });
  advance(QUIET_MS);
  expect(await store.status(bia)).toMatchObject({ state: "uploading", stale: true, by: "Ana" });
  expect(await store.put(bia, 8, 20, bytes(8, 2))).toMatchObject({ ok: true, received: 16 });
  expect(await store.status(ana)).toMatchObject({ by: "Bia", mine: false });
});

test("a size out of bounds, or a piece too big, is turned down", async () => {
  const { store } = await setup();
  expect(await store.put(ana, 0, 9, bytes(8, 1))).toMatchObject({ ok: false, status: 400, code: "size" });
  expect(await store.put(ana, 0, 101, bytes(8, 1))).toMatchObject({ ok: false, status: 400, code: "size" });
  expect(await store.put(ana, 0, 20, bytes(9, 1))).toMatchObject({ ok: false, status: 413 });
  expect(await store.status(ana)).toEqual({ state: "empty" });
});

test("another file mid-way (another size) starts over", async () => {
  const { dir, store } = await setup();
  await store.put(ana, 0, 20, bytes(8, 1));
  expect(await store.put(ana, 8, 30, bytes(8, 2))).toMatchObject({ ok: false, code: "order", received: 0 });
  expect(await store.put(ana, 0, 30, bytes(8, 2))).toMatchObject({ ok: true, received: 8 });
  expect([...(await readFile(join(dir, "upload", "disc.iso.part")))]).toEqual([...bytes(8, 2)]);
});

test("the builder's state: building, failed, refused, ready, and a newer image isn't shown an older result", async () => {
  const { dir, store, now } = await setup();
  await writeFile(join(dir, "disc.iso"), "x");
  const mtime = (await stat(join(dir, "disc.iso"))).mtimeMs;
  const builder = (s: object) => writeFile(join(dir, "status.json"), JSON.stringify({ at: now(), ...s }));
  await builder({ state: "building", iso: mtime, step: 3, total: 5, label: "Compilando o jogo", startedAt: now() - 5000 });
  expect(await store.status(ana)).toEqual({ state: "building", step: 3, total: 5, label: "Compilando o jogo", elapsed: 5000 });
  await builder({ state: "failed", iso: mtime, message: "erro", refused: false });
  expect(await store.status(ana)).toEqual({ state: "failed", message: "erro", refused: false });
  await builder({ state: "failed", iso: mtime - 1, message: "erro" });
  expect(await store.status(ana)).toEqual({ state: "queued" });
  // Turned down: the builder deleted the image.
  await rm(join(dir, "disc.iso"));
  await builder({ state: "failed", iso: mtime, message: "não é a americana", refused: true });
  expect(await store.status(ana)).toEqual({ state: "failed", message: "não é a americana", refused: true });
  await builder({ state: "idle" });
  expect(await store.status(ana)).toEqual({ state: "empty" });
  // Built.
  await writeFile(join(dir, "disc.iso"), "x");
  await mkdir(join(dir, "build"));
  await writeFile(join(dir, "build", "index.html"), "game");
  expect(await store.status(ana)).toEqual({ state: "ready" });
  // A quiet builder only matters while there's something to build.
  await builder({ state: "ready", at: now() - QUIET_MS - 1 });
  expect(await store.status(ana)).toEqual({ state: "ready" });
});

test("retry leaves the file for the builder", async () => {
  const { dir, store } = await setup();
  await store.retry();
  expect(await stat(join(dir, "retry")).then(() => true)).toBe(true);
});
