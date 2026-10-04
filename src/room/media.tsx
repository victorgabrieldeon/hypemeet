import { RemoteAudioTrack, type Room, type Track } from "livekit-client";
import { useEffect, useRef } from "react";
import { volumeKey } from "./model";
import { useVolumes } from "./volume";

export function VideoView({ track, mirror, fit }: { track: Track; mirror?: boolean; fit: "cover" | "contain" }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current!;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      className={`size-full ${fit === "cover" ? "object-cover" : "object-contain"} ${mirror ? "-scale-x-100" : ""}`}
    />
  );
}

function RemoteAudio({ track, volume }: { track: RemoteAudioTrack; volume: number }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current!;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  // Declared after attach on purpose: setVolume only reaches attached elements / the gain node.
  useEffect(() => track.setVolume(volume), [track, volume]);
  return <audio ref={ref} hidden />;
}

/** Plays every remote audio track (mics + screen audio) at the listener's chosen volume. */
export function RoomAudio({ room }: { room: Room }) {
  const volumes = useVolumes();
  const items = [];
  for (const participant of room.remoteParticipants.values()) {
    for (const pub of participant.audioTrackPublications.values()) {
      if (!(pub.track instanceof RemoteAudioTrack)) continue;
      const { volume, muted } = volumes.get(volumeKey(participant, pub));
      items.push(<RemoteAudio key={pub.trackSid} track={pub.track} volume={muted ? 0 : volume} />);
    }
  }
  return <>{items}</>;
}
