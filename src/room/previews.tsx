import {
  RoomEvent,
  Track,
  type ByteStreamReader,
  type LocalTrackPublication,
  type RemoteParticipant,
  type Room,
  type TrackPublication,
} from "livekit-client";
import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";

/**
 * Stream previews, like Discord's: whoever shares a screen snapshots it every few seconds and sends
 * the still to the room as a byte stream on "screen-preview" (attribute `sid` = the screen's track).
 * Screens are opt-in (see useSubscriptions), so this is what people who aren't watching see on the
 * tile: a few KB every EVERY_MS instead of the live video. Newcomers get the latest still on arrival.
 */
const TOPIC = "screen-preview";
/** Longest side of a still. */
const SIDE = 480;
const QUALITY = 0.7;
/** Retry delay until the first still goes out (the capture needs a frame first), then the refresh rate. */
const FIRST_MS = 1000;
const EVERY_MS = 10_000;
const MAX_BYTES = 256 * 1024;
const TYPES = ["image/webp", "image/jpeg"];

interface Outgoing {
  pub: LocalTrackPublication;
  /** Detached, muted player of the capture: holds the latest frame to draw from. */
  video: HTMLVideoElement;
  timer: ReturnType<typeof setTimeout>;
  last: Blob | null;
}

/** Created with the Room, before connecting: streams arriving before a handler exists are dropped. */
export class ScreenPreviews {
  /** Remote screen's track sid → object URL of its latest still. */
  private urls = new Map<string, string>();
  private outgoing = new Map<string, Outgoing>();
  private listeners = new Set<() => void>();
  private canvas = document.createElement("canvas");

  constructor(private room: Room) {
    room
      .on(RoomEvent.LocalTrackPublished, this.onLocalPublished)
      .on(RoomEvent.LocalTrackUnpublished, this.onLocalUnpublished)
      .on(RoomEvent.TrackUnpublished, this.onRemoteUnpublished)
      .on(RoomEvent.ParticipantConnected, this.onParticipantConnected);
    room.registerByteStreamHandler(TOPIC, (reader, { identity }) => void this.onPreview(reader, identity));
  }

  dispose() {
    this.room
      .off(RoomEvent.LocalTrackPublished, this.onLocalPublished)
      .off(RoomEvent.LocalTrackUnpublished, this.onLocalUnpublished)
      .off(RoomEvent.TrackUnpublished, this.onRemoteUnpublished)
      .off(RoomEvent.ParticipantConnected, this.onParticipantConnected);
    this.room.unregisterByteStreamHandler(TOPIC);
    for (const sid of [...this.outgoing.keys()]) this.stopSending(sid);
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    this.listeners.clear();
  }

  /** For useSyncExternalStore. */
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  get(sid: string): string | null {
    return this.urls.get(sid) ?? null;
  }

  private set(sid: string, url: string | null) {
    const old = this.urls.get(sid);
    if (old) URL.revokeObjectURL(old);
    if (url) this.urls.set(sid, url);
    else this.urls.delete(sid);
    for (const listener of this.listeners) listener();
  }

  private onLocalPublished = (pub: LocalTrackPublication) => {
    if (pub.source !== Track.Source.ScreenShare || this.outgoing.has(pub.trackSid)) return;
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    const out: Outgoing = { pub, video, timer: setTimeout(() => void this.tick(out), FIRST_MS), last: null };
    this.outgoing.set(pub.trackSid, out);
  };

  private onLocalUnpublished = (pub: LocalTrackPublication) => this.stopSending(pub.trackSid);

  private stopSending(sid: string) {
    const out = this.outgoing.get(sid);
    if (!out) return;
    clearTimeout(out.timer);
    out.video.srcObject = null;
    this.outgoing.delete(sid);
  }

  private async tick(out: Outgoing) {
    const blob = await this.snapshot(out).catch(() => null);
    if (this.outgoing.get(out.pub.trackSid) !== out) return;
    if (blob) {
      out.last = blob;
      if (this.room.remoteParticipants.size) await this.send(out.pub.trackSid, blob);
    }
    if (this.outgoing.get(out.pub.trackSid) !== out) return;
    out.timer = setTimeout(() => void this.tick(out), out.last ? EVERY_MS : FIRST_MS);
  }

  private async snapshot({ pub, video }: Outgoing): Promise<Blob | null> {
    const media = pub.track?.mediaStreamTrack;
    if (!media || media.readyState !== "live") return null;
    if ((video.srcObject as MediaStream | null)?.getVideoTracks()[0] !== media) {
      video.srcObject = new MediaStream([media]);
      await video.play();
    }
    const { videoWidth: width, videoHeight: height } = video;
    if (!width || !height) return null;
    const scale = Math.min(1, SIDE / Math.max(width, height));
    this.canvas.width = Math.round(width * scale);
    this.canvas.height = Math.round(height * scale);
    this.canvas.getContext("2d")!.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
    // toBlob silently falls back to PNG where WebP encoding is missing (Safari); JPEG then.
    for (const type of TYPES) {
      const blob = await new Promise<Blob | null>((resolve) => this.canvas.toBlob(resolve, type, QUALITY));
      if (blob?.type === type && blob.size <= MAX_BYTES) return blob;
    }
    return null;
  }

  private async send(sid: string, blob: Blob, to?: string) {
    await this.room.localParticipant
      .sendBytes(new Uint8Array(await blob.arrayBuffer()), {
        topic: TOPIC,
        mimeType: blob.type,
        name: "preview",
        attributes: { sid },
        destinationIdentities: to ? [to] : undefined,
      })
      .catch(() => undefined);
  }

  private onParticipantConnected = (participant: RemoteParticipant) => {
    for (const [sid, out] of this.outgoing) if (out.last) void this.send(sid, out.last, participant.identity);
  };

  private onRemoteUnpublished = (pub: TrackPublication) => {
    if (this.urls.has(pub.trackSid)) this.set(pub.trackSid, null);
  };

  private async onPreview(reader: ByteStreamReader, identity: string) {
    const { mimeType, size, attributes } = reader.info;
    const sid = attributes?.sid;
    if (!sid || !TYPES.includes(mimeType) || (size ?? Infinity) > MAX_BYTES) return;
    // Only the screen's own sender may set its preview.
    const pub = this.room.getParticipantByIdentity(identity)?.trackPublications.get(sid);
    if (pub?.source !== Track.Source.ScreenShare) return;
    try {
      const blob = new Blob((await reader.readAll()) as Uint8Array<ArrayBuffer>[], { type: mimeType });
      if (blob.size > MAX_BYTES) return;
      // Ended while the bytes were on their way.
      if (this.room.getParticipantByIdentity(identity)?.trackPublications.get(sid) !== pub) return;
      this.set(sid, URL.createObjectURL(blob));
    } catch {
      // A broken-off still is just skipped; the next one replaces it.
    }
  }
}

const PreviewsContext = createContext<ScreenPreviews | null>(null);

export function PreviewsProvider({ previews, children }: { previews: ScreenPreviews; children: ReactNode }) {
  return <PreviewsContext.Provider value={previews}>{children}</PreviewsContext.Provider>;
}

/** Latest still of a remote screen, or null (none yet, or no sid given). */
export function useScreenPreview(sid: string | null): string | null {
  const store = useContext(PreviewsContext);
  if (!store) throw new Error("useScreenPreview outside PreviewsProvider");
  return useSyncExternalStore(store.subscribe, () => (sid ? store.get(sid) : null));
}
