import { expect, test } from "bun:test";
import type { Track } from "livekit-client";
import type { TileModel } from "./model";
import { floatableTrack, pipFocus } from "./pip";

const track = { kind: "video", sid: "TR_video" } as Track;
const someone = { identity: "ana", name: "Ana", isLocal: false };
const you = { identity: "eu", name: "Eu", isLocal: true };
const pub = (fields: { isDesired?: boolean; isMuted?: boolean; track?: Track } = {}) => ({
  trackSid: "TR_video",
  isDesired: true,
  isMuted: false,
  track,
  ...fields,
});
const screen = (participant: object, video: object) =>
  ({ kind: "screen", id: "TR_video", participant, video, number: null, viewers: [] }) as unknown as TileModel;
const camera = (participant: { identity: string }, cam?: object) =>
  ({ kind: "camera", id: participant.identity, participant, camera: cam }) as unknown as TileModel;

test("pip: someone's screen floats while you watch it", () => {
  expect(floatableTrack(screen(someone, pub()))).toBe(track);
});

test("pip: a screen you stopped watching doesn't float, even before its track goes away", () => {
  expect(floatableTrack(screen(someone, pub({ isDesired: false })))).toBeUndefined();
});

test("pip: a screen whose track hasn't arrived yet doesn't float", () => {
  expect(floatableTrack(screen(someone, pub({ track: undefined })))).toBeUndefined();
});

test("pip: someone's camera floats only while it's on", () => {
  expect(floatableTrack(camera(someone, pub()))).toBe(track);
  expect(floatableTrack(camera(someone, pub({ isMuted: true })))).toBeUndefined();
  expect(floatableTrack(camera(someone))).toBeUndefined();
});

test("pip: your own screen and camera don't float", () => {
  expect(floatableTrack(screen(you, pub()))).toBeUndefined();
  expect(floatableTrack(camera(you, pub()))).toBeUndefined();
});

// The Discord Activity's picture-in-picture shows one tile; tiles come screens first, as buildTiles orders them.
const leo = { identity: "leo", name: "Leo", isLocal: false };
const tile = (kind: "screen" | "camera", id: string, participant: object, video?: object) =>
  (kind === "screen"
    ? { kind, id, participant, video, number: null, viewers: [] }
    : { kind, id, participant, camera: video }) as unknown as TileModel;
const yourScreen = tile("screen", "TR_eu", you, pub());
const anaScreen = tile("screen", "TR_ana", someone, pub());
const leoScreenUnwatched = tile("screen", "TR_leo", leo, pub({ isDesired: false }));
const yourCamera = tile("camera", "eu", you, pub());
const anaCamera = tile("camera", "ana", someone, pub());
const leoCamera = tile("camera", "leo", leo, pub());
const all = [yourScreen, leoScreenUnwatched, anaScreen, yourCamera, anaCamera, leoCamera];

test("pip focus: the tile in the floating window comes first", () => {
  expect(pipFocus(all, { floating: "leo", pinned: "TR_ana" })).toBe(leoCamera);
});

test("pip focus: then the pinned tile", () => {
  expect(pipFocus(all, { floating: null, pinned: "leo" })).toBe(leoCamera);
});

test("pip focus: a pinned tile that can't float gives way to the next pick", () => {
  expect(pipFocus(all, { floating: null, pinned: "TR_eu" })).toBe(anaScreen);
});

test("pip focus: otherwise the first screen you're watching, before any camera", () => {
  expect(pipFocus(all, { floating: null, pinned: null })).toBe(anaScreen);
});

test("pip focus: with no screen to show, someone's camera", () => {
  expect(pipFocus([yourScreen, leoScreenUnwatched, yourCamera, leoCamera], { floating: null, pinned: null })).toBe(leoCamera);
});

test("pip focus: nothing when only your own video or unwatched screens are around", () => {
  expect(pipFocus([yourScreen, leoScreenUnwatched, yourCamera], { floating: null, pinned: null })).toBeNull();
});
