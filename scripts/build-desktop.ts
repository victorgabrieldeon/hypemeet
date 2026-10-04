#!/usr/bin/env bun
// Packages the desktop app (desktop/) into installers for Windows and/or Linux.
//
//   bun run desktop:build --url https://meet.seudominio.com            # this OS
//   bun run desktop:build --url https://meet.seudominio.com --win --linux
//
// --url (or HYPEMEET_URL) is baked in as the default server; without it the app asks on first run.
// Output: desktop/release/.
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const DESKTOP = join(import.meta.dir, "..", "desktop");

const { values } = parseArgs({
  options: {
    url: { type: "string" },
    win: { type: "boolean", default: false },
    linux: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help) {
  console.log(`uso: bun run desktop:build [--url <servidor>] [--win] [--linux]

  --url     servidor HypeMeet padrão (ex.: https://meet.seudominio.com); também lê HYPEMEET_URL
  --win     gera instalador (NSIS) e versão portátil para Windows
  --linux   gera AppImage e .deb para Linux
  sem --win/--linux: gera para o sistema atual`);
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

const host = process.platform === "win32" ? "win" : process.platform === "linux" ? "linux" : null;
const targets = [values.win && "win", values.linux && "linux"].filter(Boolean) as string[];
if (!targets.length) {
  if (!host) fail("sistema não suportado; passe --win e/ou --linux");
  targets.push(host);
}
// Windows installers need Windows tools (rcedit/signing); Linux packages need Linux tools.
// Cross builds go through electron-builder's official Docker image.
const crossWin = targets.includes("win") && host !== "win";
const crossLinux = targets.includes("linux") && host !== "linux";
if (crossLinux) fail("gere o pacote Linux em uma máquina Linux (ou WSL)");

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

const native = targets.filter((t) => !(t === "win" && crossWin));
if (native.length) await run(["bun", "run", "dist", ...native.map((t) => `--${t}`), ...builderArgs]);

if (crossWin) {
  const docker = Bun.which("docker");
  if (!docker) fail("para gerar o .exe fora do Windows é preciso Docker (ou rode este script no Windows)");
  // Root-owned files in a bind mount would outlive the container; build as the host user.
  const user = process.getuid && process.getgid ? ["--user", `${process.getuid()}:${process.getgid()}`] : [];
  // Host-side cache so Electron/NSIS downloads survive between runs and stay user-owned.
  const cache = join(homedir(), ".cache", "hypemeet-desktop-builder");
  mkdirSync(cache, { recursive: true });
  await run([
    docker, "run", "--rm", ...user,
    "-v", `${DESKTOP}:/project`,
    "-v", `${cache}:/cache`,
    "-e", "ELECTRON_CACHE=/cache/electron",
    "-e", "ELECTRON_BUILDER_CACHE=/cache/electron-builder",
    "-e", "HOME=/tmp",
    "-w", "/project",
    "electronuserland/builder:wine",
    "node_modules/.bin/electron-builder", "--win", ...builderArgs,
  ]);
}

console.log(`\n✔ pronto: ${join(DESKTOP, "release")}`);
