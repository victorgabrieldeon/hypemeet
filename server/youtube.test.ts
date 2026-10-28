import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createYouTubeRelay, parseResolved, RelayError, usableUntil } from "./youtube";

test("yt-dlp output: the media URL, lives refused", () => {
  expect(parseResolved("False\nhttps://rr1.googlevideo.com/videoplayback?expire=1\n")).toBe("https://rr1.googlevideo.com/videoplayback?expire=1");
  expect(() => parseResolved("True\nhttps://x.googlevideo.com/manifest.m3u8")).toThrow(RelayError);
  expect(() => parseResolved("False\nNA")).toThrow(RelayError);
  expect(() => parseResolved("")).toThrow(RelayError);
});

test("media URL expiry, with a margin", () => {
  expect(usableUntil("https://x.googlevideo.com/v?expire=2000000")).toBe(2_000_000_000 - 600_000);
  expect(usableUntil("https://x.googlevideo.com/v", 1000)).toBe(1000 + 3_600_000);
});

// A fake yt-dlp (counts its runs, prints the `out` file or fails when it's empty) and a fake googlevideo.
const dir = mkdtempSync(join(tmpdir(), "relay-"));
const bin = join(dir, "yt-dlp");
const runs = join(dir, "runs");
const out = join(dir, "out");
writeFileSync(bin, `#!/bin/sh\necho x >> ${runs}\n[ -s ${out} ] || exit 1\ncat ${out}\n`);
chmodSync(bin, 0o755);
const video = join(dir, "video.mp4");
writeFileSync(video, new Uint8Array(1000).map((_, i) => i % 256));
// Bun.serve answers Range itself for a static Bun.file route.
const upstream = Bun.serve({ port: 0, routes: { "/ok": new Response(Bun.file(video)) }, fetch: () => new Response(null, { status: 403 }) });
afterAll(() => void upstream.stop(true));
const count = () => readFileSync(runs, "utf8").split("\n").length - 1;
const get = (relay: ReturnType<typeof createYouTubeRelay>, id: string, range?: string) =>
  relay.stream(id, new Request("http://x/", { headers: range ? { range } : {} }));

test("relay: Range passes through, one yt-dlp run per video", async () => {
  writeFileSync(out, `False\n${upstream.url}ok\n`);
  writeFileSync(runs, "");
  const relay = createYouTubeRelay(bin);
  const res = await get(relay, "aaaaaaaaaaa", "bytes=10-19");
  expect(res.status).toBe(206);
  expect(res.headers.get("content-range")).toBe("bytes 10-19/1000");
  expect(res.headers.get("content-type")).toBe("video/mp4");
  expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  expect((await get(relay, "aaaaaaaaaaa")).status).toBe(200);
  expect(count()).toBe(1);
});

test("relay: a refused video isn't asked for again at every request", async () => {
  writeFileSync(runs, "");
  writeFileSync(out, "");
  const failing = createYouTubeRelay(bin);
  expect((await get(failing, "bbbbbbbbbbb")).status).toBe(502);
  expect((await get(failing, "bbbbbbbbbbb")).status).toBe(502);
  expect(count()).toBe(1);

  writeFileSync(runs, "");
  writeFileSync(out, `False\n${upstream.url}refused\n`);
  const refused = createYouTubeRelay(bin);
  expect((await get(refused, "ccccccccccc")).status).toBe(502);
  expect((await get(refused, "ccccccccccc")).status).toBe(502);
  // The first 403 finds the URL again once; then it's remembered.
  expect(count()).toBe(2);
});

test("relay: no yt-dlp installed", async () => {
  expect((await get(createYouTubeRelay(join(dir, "missing")), "ddddddddddd")).status).toBe(503);
});
