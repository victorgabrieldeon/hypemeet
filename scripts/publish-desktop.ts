#!/usr/bin/env bun
// Publishes the desktop/release/ builds as a GitHub Release of the public releases repo (this repo
// stays private). Assets drop the version from their names, so the site's
// /releases/latest/download/<file> links always serve the newest build.
//
//   bun run desktop:build --url https://meet.seudominio.com --win --linux --mac
//   bun run desktop:publish
//
// Re-running for the same version replaces the assets. Needs `gh` logged in.
import { linkSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DESKTOP_FILES, DESKTOP_PLATFORMS, RELEASES_REPO } from "../src/lib/downloads";

const DESKTOP = join(import.meta.dir, "..", "desktop");
const RELEASE_DIR = join(DESKTOP, "release");

function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

const { version } = await Bun.file(join(DESKTOP, "package.json")).json();
const tag = `v${version}`;

// HypeMeet-Setup-0.1.0.exe → HypeMeet-Setup.exe, HypeMeet-0.1.0-mac-arm64.zip → HypeMeet-mac-arm64.zip
const built = new Map(readdirSync(RELEASE_DIR).map((name) => [name.replace(`-${version}`, ""), name]));
const missing = DESKTOP_FILES.filter((file) => !built.has(file));
if (missing.length) {
  fail(`faltam builds da versão ${version}: ${missing.join(", ")}\n  rode: bun run desktop:build --url <servidor> --win --linux --mac`);
}

// Hard links under release/ (same filesystem) give the assets their version-less names for free.
const staging = join(RELEASE_DIR, ".publish");
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging);
const assets = DESKTOP_FILES.map((file) => {
  const path = join(staging, file);
  linkSync(join(RELEASE_DIR, built.get(file)!), path);
  return path;
});

async function gh(args: string[], quiet = false) {
  if (!quiet) console.log(`\n$ gh ${args.join(" ")}`);
  const proc = Bun.spawn(["gh", ...args], { stdio: ["inherit", quiet ? "ignore" : "inherit", quiet ? "ignore" : "inherit"] });
  return (await proc.exited) === 0;
}

const notes = Object.values(DESKTOP_PLATFORMS)
  .map(({ name, hint, builds }) => `**${name}**: ${builds.map((b) => `\`${b.file}\` (${b.label})`).join(", ")}\n${hint}`)
  .join("\n\n");

try {
  const exists = await gh(["release", "view", tag, "-R", RELEASES_REPO], true);
  const ok = exists
    ? await gh(["release", "upload", tag, ...assets, "--clobber", "-R", RELEASES_REPO])
    : await gh(["release", "create", tag, ...assets, "-R", RELEASES_REPO, "--title", `HypeMeet ${version}`, "--notes", notes, "--latest"]);
  if (!ok) fail("gh falhou");
} finally {
  rmSync(staging, { recursive: true, force: true });
}

console.log(`\n✔ publicado: https://github.com/${RELEASES_REPO}/releases/tag/${tag}`);
