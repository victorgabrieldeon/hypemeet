import { expect, test } from "bun:test";
import type { Track } from "livekit-client";
import type { TileModel } from "./model";
import { floatableTrack } from "./pip";

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
