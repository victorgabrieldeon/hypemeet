import { expect, test } from "bun:test";
import { join } from "node:path";
import { patchNet, patchShell } from "./patch";

// Real excerpts of the fork's port/web/shell.html and net.js at the commit the builder uses.
const shell = await Bun.file(join(import.meta.dir, "fixtures", "shell.html")).text();
const net = await Bun.file(join(import.meta.dir, "fixtures", "net.js")).text();

test("the page: the disc, the fallback image and telemetry become relative; F1/Tab/Esc stay in the game", () => {
  const out = patchShell(shell);
  expect(out).toContain("pieceDisc('disc')");
  expect(out).toContain("Q.get('disc') || 'disc.iso'");
  expect(out).toContain("fetch('telemetry'");
  expect(out).not.toMatch(/['"`]\/(disc|telemetry)/);
  expect(out).toContain("getElementById('canvas').addEventListener('keydown'");
  expect(out).toContain("e.key === 'F1' || e.key === 'Tab' || e.key === 'Escape'");
  expect(out.trimEnd()).toMatch(/<\/script>\n<\/body>\r?\n<\/html>$/);
});

test("net.js: the room and Quick Match sockets and the stats go next to the page", () => {
  const out = patchNet(net);
  expect(out).toContain("const netUrl = (path) => new URL(path, location.href).href.replace(/^http/, 'ws');");
  expect(out).toContain("`${netUrl('net/ws')}?room=${room}`");
  expect(out).toContain("`${netUrl('net/queue')}?name=${encodeURIComponent(myName())}&cid=${cid}`");
  expect(out).toContain("fetch('net/stat'");
  expect(out).not.toContain("location.host}/");
  expect(out).not.toMatch(/['"`]\/net\//);
  // netUrl comes before its first use.
  expect(out.indexOf("const netUrl")).toBeLessThan(out.indexOf("netUrl('net/ws')"));
});

test("fails loudly when an expected piece is missing", () => {
  expect(() => patchShell(shell.replace("pieceDisc('/disc')", "pieceDisc('/disco')"))).toThrow(/pieceDisc/);
  expect(() => patchShell(shell.replace("fetch('/telemetry'", "fetch(\"/telemetry\""))).toThrow(/telemetry/);
  expect(() => patchShell(shell.replace("</body>", ""))).toThrow(/body/);
  expect(() => patchNet(net.replace("/net/queue?name=", "/net/q?name="))).toThrow(/net\/queue/);
  expect(() => patchNet(net.replace("'use strict';", ""))).toThrow(/use strict/);
  // A new absolute address the swaps don't know about.
  expect(() => patchNet(`${net}\nfetch('/net/other');`)).toThrow(/absoluto/);
});
