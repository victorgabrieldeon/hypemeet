import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GAME_FILES as SERVED } from "../../../server/bt3/routes";
import { createBuilder, GAME_FILES, REFUSED, STEPS, type Runner } from "./builder";

const fixtures = join(import.meta.dir, "fixtures");

let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  dirs = [];
});

/** A fake toolchain: records the commands; link.py webasync writes the build output. */
function fakeTools(fail: Record<string, number> = {}) {
  const calls: string[] = [];
  const statuses: unknown[] = [];
  let dir = "";
  const run: Runner = async (cmd, { cwd, log }) => {
    const name = cmd.slice(1).map((a) => a.replace(/^.*[\\/]/, "")).slice(0, 2).join(" ");
    calls.push(name);
    statuses.push(JSON.parse(await readFile(join(dir, "status.json"), "utf8")));
    log(`ran ${name}\n`);
    if (fail[name] !== undefined) return { code: fail[name]!, output: `line 1\nline 2\n${name} broke` };
    if (name === "link.py webasync") {
      const out = join(cwd, "port", "build", "web");
      await mkdir(out, { recursive: true });
      for (const f of [...GAME_FILES, "bt3_node.js", "lan.key"]) await writeFile(join(out, f), `built ${f}`);
      await writeFile(join(out, "index.html"), await readFile(join(fixtures, "shell.html")));
      await writeFile(join(out, "net.js"), await readFile(join(fixtures, "net.js")));
    }
    return { code: 0, output: "" };
  };
  return { calls, statuses, run, setDir: (d: string) => (dir = d) };
}

async function setup(tools: ReturnType<typeof fakeTools>) {
  const root = await mkdtemp(join(tmpdir(), "bt3-builder-"));
  dirs.push(root);
  const dir = join(root, "data");
  const source = join(root, "src");
  await mkdir(source, { recursive: true });
  await writeFile(join(source, "install.py"), "# the fork");
  tools.setDir(dir);
  let clock = 1_000_000;
  const builder = createBuilder({ dir, source, commit: "abc123", run: tools.run, steps: "/opt/builder/steps.py", now: () => (clock += 1000) });
  const read = async () => JSON.parse(await readFile(join(dir, "status.json"), "utf8"));
  const sendIso = async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "disc.iso"), "iso");
  };
  return { dir, builder, read, sendIso };
}

test("the same list of game files as the server serves", () => {
  expect(new Set(GAME_FILES)).toEqual(SERVED);
});

test("nothing to build: idle, with a heartbeat", async () => {
  const tools = fakeTools();
  const { builder, read } = await setup(tools);
  await builder.tick();
  const first = await read();
  expect(first).toMatchObject({ state: "idle" });
  await builder.tick();
  expect((await read()).at).toBeGreaterThan(first.at);
  expect(tools.calls).toEqual([]);
});

test("the steps in order, with state and log; publishes build/ in one swap", async () => {
  const tools = fakeTools();
  const { dir, builder, read, sendIso } = await setup(tools);
  await sendIso();
  await builder.tick();
  expect(tools.calls).toEqual([
    "steps.py disc",
    "steps.py gamedata",
    "steps.py split",
    "build.py",
    "gen_data_web.py",
    "link.py web",
    "link.py webasync",
  ]);
  // What HypeMeet read while each ran.
  expect(tools.statuses.map((s) => (s as { step: number }).step)).toEqual([1, 2, 2, 3, 3, 3, 3]);
  expect(tools.statuses[0]).toMatchObject({ state: "building", total: STEPS.length, label: "Conferindo a ISO" });
  const iso = (await stat(join(dir, "disc.iso"))).mtimeMs;
  expect(await read()).toMatchObject({ state: "ready", iso });
  // Exactly the listed files, the page and net.js adjusted; nothing else from the build.
  expect((await readdir(join(dir, "build"))).sort()).toEqual([...GAME_FILES].sort());
  expect(await readFile(join(dir, "build", "index.html"), "utf8")).toContain("pieceDisc('disc')");
  expect(await readFile(join(dir, "build", "net.js"), "utf8")).toContain("netUrl('net/ws')");
  expect(await stat(join(dir, "build.tmp")).catch(() => null)).toBeNull();
  // The fork's source was copied into work/, the tools ran there.
  expect(await readFile(join(dir, "work", "install.py"), "utf8")).toBe("# the fork");
  const log = await readFile(join(dir, "build.log"), "utf8");
  expect(log).toContain("1/5 Conferindo a ISO");
  expect(log).toContain("ran link.py webasync");
  // Built: nothing more to do.
  await builder.tick();
  expect(tools.calls.length).toBe(7);
});

test("the image turned down: failed with a clear message, and the image deleted for another", async () => {
  const tools = fakeTools({ "steps.py disc": 2 });
  const { dir, builder, read, sendIso } = await setup(tools);
  await sendIso();
  await builder.tick();
  expect(await read()).toMatchObject({ state: "failed", message: REFUSED, refused: true });
  expect(await stat(join(dir, "disc.iso")).catch(() => null)).toBeNull();
  expect(tools.calls).toEqual(["steps.py disc"]);
  // "Tentar de novo" with no image: back to asking for one.
  await writeFile(join(dir, "retry"), "");
  await builder.tick();
  expect(await read()).toMatchObject({ state: "idle" });
  expect(await stat(join(dir, "retry")).catch(() => null)).toBeNull();
});

test("a failing step is failed with the log's last lines, keeps the image, and waits for retry", async () => {
  const tools = fakeTools({ "link.py web": 1 });
  const { dir, builder, read, sendIso } = await setup(tools);
  await sendIso();
  await builder.tick();
  const failed = await read();
  expect(failed).toMatchObject({ state: "failed", refused: false, step: 3 });
  expect(failed.message).toContain("link.py web broke");
  expect(await stat(join(dir, "disc.iso")).then(() => true)).toBe(true);
  expect(await stat(join(dir, "build")).catch(() => null)).toBeNull();
  // No retry: it doesn't try again by itself.
  await builder.tick();
  expect(tools.calls.filter((c) => c === "steps.py disc").length).toBe(1);
  await writeFile(join(dir, "retry"), "");
  await builder.tick();
  expect(tools.calls.filter((c) => c === "steps.py disc").length).toBe(2);
  expect(await stat(join(dir, "retry")).catch(() => null)).toBeNull();
});

test("a crash while checking the image is not a refusal: the image stays", async () => {
  const tools = fakeTools({ "steps.py disc": 1 });
  const { dir, builder, read, sendIso } = await setup(tools);
  await sendIso();
  await builder.tick();
  expect(await read()).toMatchObject({ state: "failed", refused: false });
  expect(await stat(join(dir, "disc.iso")).then(() => true)).toBe(true);
});
