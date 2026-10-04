#!/usr/bin/env bun
// Packages the desktop app (desktop/) for Windows, Linux and/or macOS.
//
//   bun run desktop:build --url https://meet.seudominio.com            # this OS
//   bun run desktop:build --url https://meet.seudominio.com --win --linux --mac
//
// --url (or HYPEMEET_URL) is baked in as the default server; without it the app asks on first run.
// Output: desktop/release/.
import { mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const DESKTOP = join(import.meta.dir, "..", "desktop");

const { values } = parseArgs({
  options: {
    url: { type: "string" },
    win: { type: "boolean", default: false },
    linux: { type: "boolean", default: false },
    mac: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help) {
  console.log(`uso: bun run desktop:build [--url <servidor>] [--win] [--linux] [--mac]

  --url     servidor HypeMeet padrão (ex.: https://meet.seudominio.com); também lê HYPEMEET_URL
  --win     gera instalador (NSIS) e versão portátil para Windows
  --linux   gera AppImage, .deb e .tar.gz para Linux
  --mac     gera .zip para macOS (Apple Silicon e Intel), com assinatura ad-hoc via rcodesign
  sem --win/--linux/--mac: gera para o sistema atual`);
  process.exit(0);
}

function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

function normalizeServer(raw: string): string {
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (url.protocol === "https:" || url.protocol === "http:") return url.origin;
  } catch { }
  fail(`URL inválida: ${raw}`);
}

const rawUrl = values.url ?? process.env.HYPEMEET_URL;
const server = rawUrl ? normalizeServer(rawUrl) : null;

const host =
  process.platform === "win32" ? "win" : process.platform === "linux" ? "linux" : process.platform === "darwin" ? "mac" : null;
const targets = [values.win && "win", values.linux && "linux", values.mac && "mac"].filter(Boolean) as string[];
if (!targets.length) {
  if (!host) fail("sistema não suportado; passe --win, --linux e/ou --mac");
  targets.push(host);
}
// Windows installers need Windows tools (rcedit/signing); Linux packages need Linux tools.
// Cross builds go through electron-builder's official Docker image.
const crossWin = targets.includes("win") && host !== "win";
const crossLinux = targets.includes("linux") && host !== "linux";
if (crossLinux) fail("gere o pacote Linux em uma máquina Linux (ou WSL)");
// macOS packs from any OS. Without a signature Apple Silicon refuses to launch the app, and
// electron-builder only signs on macOS, so rcodesign ad-hoc signs it (no Apple account needed).
if (targets.includes("mac")) {
  for (const tool of ["rcodesign", "zip"]) {
    if (!Bun.which(tool)) fail(`--mac precisa de \`${tool}\` no PATH (rcodesign: github.com/indygreg/apple-platform-rs/releases)`);
  }
}

async function run(cmd: string[], cwd = DESKTOP) {
  console.log(`\n$ ${cmd.join(" ")}`);
  const proc = Bun.spawn(cmd, { cwd, stdio: ["inherit", "inherit", "inherit"] });
  if ((await proc.exited) !== 0) fail(`falhou: ${cmd.join(" ")}`);
}

console.log(`HypeMeet desktop → ${targets.join(" + ")}`);
console.log(
  server ? `servidor padrão: ${server}` : "sem --url: o app vai pedir o endereço do servidor na primeira vez",
);

await run(["bun", "install"]);

const builderArgs = [
  ...(server ? [`-c.extraMetadata.hypemeetUrl=${server}`] : []),
  // .deb metadata requires a homepage; the server is it. `.invalid` is the RFC 2606 "none" TLD.
  `-c.extraMetadata.homepage=${server ?? "https://hypemeet.invalid"}`,
];

// One electron-builder run per arch set: --x64/--arm64 would otherwise apply to every platform.
const native = targets.filter((t) => t !== "mac" && !(t === "win" && crossWin));
if (native.length) await run(["bun", "run", "dist", ...native.map((t) => `--${t}`), ...builderArgs]);

if (targets.includes("mac")) {
  await run(["bun", "run", "dist", "--mac", "--x64", "--arm64", ...builderArgs]);
  const { version } = await Bun.file(join(DESKTOP, "package.json")).json();
  for (const [arch, dir] of [["arm64", "mac-arm64"], ["x64", "mac"]]) {
    const outDir = join(DESKTOP, "release", dir);
    const zip = join(DESKTOP, "release", `HypeMeet-${version}-mac-${arch}.zip`);
    await run(["rcodesign", "sign", "HypeMeet.app"], outDir);
    rmSync(zip, { force: true }); // zip would merge into a stale archive
    // -y keeps the framework symlinks; flattening them doubles the size and breaks the signature.
    await run(["zip", "-qry", zip, "HypeMeet.app"], outDir);
  }
}

if (crossWin) {
  const docker = Bun.which("docker");
  if (!docker) fail("para gerar o .exe fora do Windows é preciso Docker (ou rode este script no Windows)");
  // Root-owned files in a bind mount would outlive the container; build as the host user.
  const user = process.getuid && process.getgid ? ["--user", `${process.getuid()}:${process.getgid()}`] : [];
  // Host-side cache so Electron/NSIS downloads (and the wine prefix, which refuses a HOME it
  // doesn't own) survive between runs and stay user-owned.
  const cache = join(homedir(), ".cache", "hypemeet-desktop-builder");
  mkdirSync(join(cache, "home"), { recursive: true });
  await run([
    docker, "run", "--rm", ...user,
    "-v", `${DESKTOP}:/project`,
    "-v", `${cache}:/cache`,
    "-e", "ELECTRON_CACHE=/cache/electron",
    "-e", "ELECTRON_BUILDER_CACHE=/cache/electron-builder",
    "-e", "HOME=/cache/home",
    "-w", "/project",
    "electronuserland/builder:wine",
    "node_modules/.bin/electron-builder", "--win", ...builderArgs,
  ]);
}

console.log(`\n✔ pronto: ${join(DESKTOP, "release")}`);
