import { loadRnnoise, RnnoiseWorkletNode } from "@sapphi-red/web-noise-suppressor";
import rnnoiseWorkletUrl from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url";
import rnnoiseWasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url";
import rnnoiseSimdWasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url";
import { LocalAudioTrack, ParticipantEvent, Track, type LocalParticipant } from "livekit-client";
import { useEffect, useRef } from "react";
import { soundboardBus, type MicProcessor } from "./soundboard";

const PROCESSOR_NAME = "hypemeet-rnnoise";

/** Needs AudioWorklet (secure context) — same requirement as the mic itself. */
export const canSuppressNoise = typeof AudioWorkletNode !== "undefined";

// The wasm is fetched once per page; the worklet module has to be registered once per AudioContext.
let wasm: Promise<ArrayBuffer> | null = null;
const workletLoaded = new WeakMap<BaseAudioContext, Promise<void>>();

function prepare(ctx: AudioContext) {
  wasm ??= loadRnnoise({ url: rnnoiseWasmUrl, simdUrl: rnnoiseSimdWasmUrl }).catch((err) => {
    wasm = null; // let the next attempt retry instead of caching a network failure
    throw err;
  });
  let worklet = workletLoaded.get(ctx);
  if (!worklet) {
    worklet = ctx.audioWorklet.addModule(rnnoiseWorkletUrl);
    workletLoaded.set(ctx, worklet);
    worklet.catch(() => workletLoaded.delete(ctx));
  }
  return Promise.all([wasm, worklet]).then(([binary]) => binary);
}

/**
 * RNNoise (WASM) as a LiveKit audio processor: mic → RnnoiseWorkletNode → the track that's sent.
 * Runs in the room's AudioContext, which LiveKit only provides with `webAudioMix` on.
 * RNNoise is tuned for 48 kHz; other context rates still work, just slightly less cleanly.
 */
function createRnnoiseProcessor(): MicProcessor {
  let nodes: { source: MediaStreamAudioSourceNode; rnnoise: RnnoiseWorkletNode } | null = null;
  let ctx: AudioContext;

  const processor: MicProcessor = {
    name: PROCESSOR_NAME,
    async init({ track, audioContext }) {
      ctx = audioContext;
      const wasmBinary = await prepare(audioContext);
      const source = audioContext.createMediaStreamSource(new MediaStream([track]));
      const rnnoise = new RnnoiseWorkletNode(audioContext, { maxChannels: 1, wasmBinary });
      const destination = audioContext.createMediaStreamDestination();
      source.connect(rnnoise).connect(destination);
      nodes = { source, rnnoise };
      // Soundboard sounds join after the filter, so RNNoise doesn't eat them.
      processor.soundboard = soundboardBus(audioContext, destination);
      processor.processedTrack = destination.stream.getAudioTracks()[0];
    },
    // Called with the new MediaStreamTrack when the user switches microphones. LiveKit doesn't pass
    // the AudioContext again here, so reuse the one from init.
    async restart(opts) {
      await processor.destroy();
      await processor.init({ ...opts, audioContext: ctx });
    },
    async destroy() {
      nodes?.source.disconnect();
      nodes?.rnnoise.disconnect();
      nodes?.rnnoise.destroy();
      nodes = null;
      processor.soundboard?.disconnect();
      processor.soundboard = undefined;
      processor.processedTrack?.stop();
      processor.processedTrack = undefined;
    },
  };
  return processor;
}

function micTrack(local: LocalParticipant): LocalAudioTrack | null {
  const track = local.getTrackPublication(Track.Source.Microphone)?.track;
  return track instanceof LocalAudioTrack ? track : null;
}

/**
 * Keeps the local mic's noise filter in sync with `enabled`, including mic tracks published later.
 * Changes run one at a time so a quick on/off can't leave the filter in the wrong state.
 */
export function useNoiseFilter(local: LocalParticipant, enabled: boolean, onError: (err: unknown) => void) {
  const wanted = useRef(enabled);
  wanted.current = enabled;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const queue = useRef(Promise.resolve());

  useEffect(() => {
    if (!canSuppressNoise) return;
    const sync = () => {
      queue.current = queue.current.then(async () => {
        const track = micTrack(local);
        if (!track) return;
        const active = track.getProcessor()?.name === PROCESSOR_NAME;
        try {
          if (wanted.current && !active) await track.setProcessor(createRnnoiseProcessor());
          else if (!wanted.current && active) await track.stopProcessor();
        } catch (err) {
          onErrorRef.current(err);
        }
      });
    };
    sync();
    local.on(ParticipantEvent.LocalTrackPublished, sync);
    return () => {
      local.off(ParticipantEvent.LocalTrackPublished, sync);
    };
  }, [local, enabled]);
}
