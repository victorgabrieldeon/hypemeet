import type { AudioProcessorOptions, LocalAudioTrack, Track, TrackProcessor } from "livekit-client";
import { loadNoiseFilter } from "./devices";
import { canSuppressNoise } from "./noise";
import { cueContext } from "./sounds";

/** Builds a sound into `out` starting at `t`; returns how long it lasts, in seconds. */
type Synth = (ctx: BaseAudioContext, out: AudioNode, t: number) => number;

/** Loudness in what the room hears (relative to a full-scale mic) and in our own monitor. */
const MIC_LEVEL = 0.45;
const MONITOR_LEVEL = 0.3;

function osc(ctx: BaseAudioContext, type: OscillatorType, freq: number) {
 const node = ctx.createOscillator();
 node.type = type;
 node.frequency.value = freq;
 return node;
}

function gain(ctx: BaseAudioContext, value = 0) {
 const node = ctx.createGain();
 node.gain.value = value;
 return node;
}

function filter(ctx: BaseAudioContext, type: BiquadFilterType, freq: number, q = 1) {
 const node = ctx.createBiquadFilter();
 node.type = type;
 node.frequency.value = freq;
 node.Q.value = q;
 return node;
}

function noise(ctx: BaseAudioContext, seconds: number) {
 const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
 const data = buffer.getChannelData(0);
 for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
 const node = ctx.createBufferSource();
 node.buffer = buffer;
 return node;
}

/** tanh soft clipper: grit for the horn and the boom, and keeps stacked oscillators from clipping. */
function saturate(ctx: BaseAudioContext, drive: number) {
 const curve = new Float32Array(1024);
 for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(((i / (curve.length - 1)) * 2 - 1) * drive);
 const node = ctx.createWaveShaper();
 node.curve = curve;
 return node;
}

/** Fast attack to `peak`, exponential decay to silence by `t + decay`. */
function hit(param: AudioParam, t: number, peak: number, decay: number) {
 param.setValueAtTime(0, t);
 param.linearRampToValueAtTime(peak, t + 0.004);
 param.exponentialRampToValueAtTime(0.0001, t + decay);
}

/** Drum-ish thump: a sine whose pitch falls from `from` to `to`. */
function thump(ctx: BaseAudioContext, out: AudioNode, t: number, from: number, to: number, decay: number, peak: number) {
 const tone = osc(ctx, "sine", from);
 tone.frequency.setValueAtTime(from, t);
 tone.frequency.exponentialRampToValueAtTime(to, t + decay * 0.6);
 const amp = gain(ctx);
 hit(amp.gain, t, peak, decay);
 tone.connect(amp).connect(out);
 tone.start(t);
 tone.stop(t + decay + 0.02);
}

/** Three blasts of a detuned sawtooth chord, the last one held. */
const airhorn: Synth = (ctx, out, t) => {
 const bus = gain(ctx, 1);
 bus.connect(saturate(ctx, 2.5)).connect(filter(ctx, "lowpass", 3200)).connect(gain(ctx, 0.55)).connect(out);
 for (const [offset, length] of [[0, 0.11], [0.15, 0.11], [0.3, 0.8]]) {
  const s = t + offset;
  const amp = gain(ctx);
  amp.gain.setValueAtTime(0, s);
  amp.gain.linearRampToValueAtTime(0.3, s + 0.015);
  amp.gain.setValueAtTime(0.3, s + length - 0.04);
  amp.gain.linearRampToValueAtTime(0, s + length);
  amp.connect(bus);
  for (const [freq, detune] of [[466, -9], [466, 8], [233, 0], [699, 5]]) {
   const voice = osc(ctx, "sawtooth", freq);
   voice.detune.value = detune;
   // Horns bend up into pitch as the air builds.
   voice.frequency.setValueAtTime(freq * 0.93, s);
   voice.frequency.exponentialRampToValueAtTime(freq, s + 0.05);
   voice.connect(amp);
   voice.start(s);
   voice.stop(s + length + 0.01);
  }
 }
 return 1.15;
};

/**
 * Formant synthesis: a falling, low sawtooth "voice" through three band-passes that glide from an
 * r-coloured onset to the "uh" vowel, with a rolled-r flutter up front and a breathy "h" at the end.
 */
const bruh: Synth = (ctx, out, t) => {
 const length = 0.6;
 const voice = osc(ctx, "sawtooth", 112);
 voice.frequency.setValueAtTime(112, t);
 voice.frequency.linearRampToValueAtTime(96, t + 0.2);
 voice.frequency.exponentialRampToValueAtTime(70, t + length);

 const amp = gain(ctx);
 amp.gain.setValueAtTime(0, t);
 amp.gain.linearRampToValueAtTime(1, t + 0.025);
 for (let i = 0; i < 3; i++) {
  const p = t + 0.025 + i * 0.028;
  amp.gain.setValueAtTime(1, p);
  amp.gain.linearRampToValueAtTime(0.4, p + 0.014);
  amp.gain.linearRampToValueAtTime(1, p + 0.028);
 }
 amp.gain.setValueAtTime(1, t + length - 0.22);
 amp.gain.exponentialRampToValueAtTime(0.0001, t + length);

 // "b": lips closed (muffled) then released.
 const lips = filter(ctx, "lowpass", 300);
 lips.frequency.setValueAtTime(300, t);
 lips.frequency.exponentialRampToValueAtTime(5000, t + 0.05);
 voice.connect(amp).connect(lips);

 const mouth = gain(ctx, 3.2);
 mouth.connect(out);
 const formants: [from: number, to: number, q: number, level: number][] = [
  [420, 640, 6, 1],
  [1000, 1190, 9, 0.55],
  [1600, 2390, 12, 0.3],
 ];
 const breath = noise(ctx, 0.3);
 const breathAmp = gain(ctx);
 const h = t + length - 0.18;
 breathAmp.gain.setValueAtTime(0, h);
 breathAmp.gain.linearRampToValueAtTime(0.08, h + 0.08);
 breathAmp.gain.exponentialRampToValueAtTime(0.0001, h + 0.28);
 breath.connect(breathAmp);
 for (const [from, to, q, level] of formants) {
  const band = filter(ctx, "bandpass", from, q);
  band.frequency.setValueAtTime(from, t);
  band.frequency.exponentialRampToValueAtTime(to, t + 0.14);
  const bandLevel = gain(ctx, level);
  lips.connect(band);
  breathAmp.connect(band);
  band.connect(bandLevel).connect(mouth);
 }
 voice.start(t);
 voice.stop(t + length + 0.02);
 breath.start(h);
 return length + 0.12;
};

/** The meme "boom": a saturated sub drop with a click on top. */
const boom: Synth = (ctx, out, t) => {
 const body = gain(ctx, 1);
 body.connect(saturate(ctx, 3)).connect(gain(ctx, 0.8)).connect(out);
 thump(ctx, body, t, 95, 40, 1.4, 1);
 thump(ctx, body, t, 190, 80, 0.5, 0.35);
 const click = noise(ctx, 0.03);
 const clickAmp = gain(ctx);
 hit(clickAmp.gain, t, 0.5, 0.03);
 click.connect(filter(ctx, "lowpass", 2000)).connect(clickAmp).connect(out);
 click.start(t);
 return 1.45;
};

/** Ba-dum-tss: two toms, then kick + cymbal. */
const rimshot: Synth = (ctx, out, t) => {
 thump(ctx, out, t, 220, 130, 0.22, 0.6);
 thump(ctx, out, t + 0.17, 165, 90, 0.28, 0.6);
 const crash = t + 0.4;
 thump(ctx, out, crash, 110, 50, 0.3, 0.55);
 const cymbal = noise(ctx, 1);
 const amp = gain(ctx);
 hit(amp.gain, crash, 0.35, 0.95);
 cymbal.connect(filter(ctx, "highpass", 6500)).connect(amp).connect(out);
 cymbal.start(crash);
 return 1.4;
};

/** Wah wah wah waaah: four falling semitones through a "plunger" filter, the last one wobbling. */
const sadTrombone: Synth = (ctx, out, t) => {
 const notes: [freq: number, offset: number, length: number][] = [
  [293.66, 0, 0.4],
  [277.18, 0.44, 0.4],
  [261.63, 0.88, 0.4],
  [246.94, 1.32, 1.15],
 ];
 const horn = osc(ctx, "sawtooth", notes[0][0]);
 const plunger = filter(ctx, "lowpass", 500, 5);
 const amp = gain(ctx);
 horn.connect(plunger).connect(amp).connect(out);
 for (const [freq, offset, length] of notes) {
  const s = t + offset;
  horn.frequency.setTargetAtTime(freq, s, 0.015);
  amp.gain.setValueAtTime(0, s);
  amp.gain.linearRampToValueAtTime(0.4, s + 0.04);
  amp.gain.setValueAtTime(0.4, s + length - 0.08);
  amp.gain.linearRampToValueAtTime(0, s + length);
  plunger.frequency.setValueAtTime(450, s);
  plunger.frequency.linearRampToValueAtTime(1500, s + 0.12);
  plunger.frequency.linearRampToValueAtTime(800, s + length);
 }
 const [, lastOffset, lastLength] = notes[3];
 const wobble = osc(ctx, "sine", 5.5);
 const depth = gain(ctx, 0);
 depth.gain.setValueAtTime(0, t + lastOffset + 0.2);
 depth.gain.linearRampToValueAtTime(7, t + lastOffset + 0.5);
 wobble.connect(depth).connect(horn.frequency);
 const end = t + lastOffset + lastLength;
 horn.start(t);
 horn.stop(end + 0.02);
 wobble.start(t);
 wobble.stop(end + 0.02);
 return end - t;
};

/** Awkward silence: two crickets chirping out of step. */
const crickets: Synth = (ctx, out, t) => {
 for (const [freq, delay] of [[4400, 0], [4900, 0.22]]) {
  const tone = osc(ctx, "sine", freq);
  const amp = gain(ctx);
  tone.connect(amp).connect(out);
  for (let chirp = 0; chirp < 4; chirp++) {
   for (let pulse = 0; pulse < 3; pulse++) {
    const p = t + delay + chirp * 0.45 + pulse * 0.035;
    amp.gain.setValueAtTime(0, p);
    amp.gain.linearRampToValueAtTime(0.35, p + 0.008);
    amp.gain.linearRampToValueAtTime(0, p + 0.022);
   }
  }
  tone.start(t);
  tone.stop(t + 1.95);
 }
 return 1.95;
};

/** In the order they show up on the board. */
export const SOUNDS = {
 airhorn: { label: "Airhorn", emoji: "📯", synth: airhorn },
 bruh: { label: "BRUH", emoji: "😐", synth: bruh },
 boom: { label: "Boom", emoji: "💥", synth: boom },
 rimshot: { label: "Tum dum tss", emoji: "🥁", synth: rimshot },
 sadTrombone: { label: "Trombone triste", emoji: "🎺", synth: sadTrombone },
 crickets: { label: "Grilos", emoji: "🦗", synth: crickets },
} satisfies Record<string, { label: string; emoji: string; synth: Synth }>;

export type SoundId = keyof typeof SOUNDS;

/**
 * A track can only have one processor, so every mic processor of ours carries the soundboard bus:
 * the noise filter builds one in, and without it the soundboard installs a plain mixer.
 */
export type MicProcessor = TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> & { soundboard?: GainNode };

/** Bus for soundboard sounds, mixed into `out` (the processed mic) in the room's context. */
export function soundboardBus(ctx: AudioContext, out: AudioNode): GainNode {
 const bus = gain(ctx, MIC_LEVEL);
 bus.connect(out);
 return bus;
}

/** Voice passed through untouched, plus the soundboard bus. */
function createMixer(): MicProcessor {
 let ctx: AudioContext;
 let out: MediaStreamAudioDestinationNode;
 let source: MediaStreamAudioSourceNode | undefined;
 const tap = (track: MediaStreamTrack) => {
  source?.disconnect();
  source = ctx.createMediaStreamSource(new MediaStream([track]));
  source.connect(out);
 };
 const mixer: MicProcessor = {
  name: "hypemeet-soundboard",
  async init({ track, audioContext }) {
   ctx = audioContext;
   out = audioContext.createMediaStreamDestination();
   mixer.soundboard = soundboardBus(audioContext, out);
   tap(track);
   mixer.processedTrack = out.stream.getAudioTracks()[0];
  },
  // Called with the new capture when the user switches microphones.
  async restart({ track }) {
   tap(track);
  },
  async destroy() {
   source?.disconnect();
   mixer.soundboard?.disconnect();
   mixer.processedTrack?.stop();
  },
 };
 return mixer;
}

/** The mixer goes in on the first sound, not on join, so the mic path stays stock for people who never use it. */
async function busFor(mic: LocalAudioTrack): Promise<GainNode | undefined> {
 const current = mic.getProcessor() as MicProcessor | undefined;
 // With the noise filter on, its processor carries the bus. It may still be loading: installing a
 // mixer now would land after it and silently replace the filter, so this sound stays local.
 if (current?.soundboard || (canSuppressNoise && loadNoiseFilter())) return current?.soundboard;
 const mixer = createMixer();
 await mic.setProcessor(mixer);
 return mixer.soundboard;
}

/** Plays `synth` into `out` through its own gain, so it can be cut short. */
function voice(ctx: BaseAudioContext, out: AudioNode, synth: Synth, volume: number) {
 const level = gain(ctx, volume);
 level.connect(out);
 const t = ctx.currentTime + 0.02;
 const length = synth(ctx, level, t);
 const timer = setTimeout(() => level.disconnect(), (length + 0.5) * 1000);
 return {
  length,
  stop() {
   clearTimeout(timer);
   level.gain.cancelScheduledValues(ctx.currentTime);
   level.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
   setTimeout(() => level.disconnect(), 200);
  },
 };
}

let playing: { stop(): void } | null = null;

/** Cuts the sound that's playing, for us and for the room. */
export function stopSound() {
 playing?.stop();
 playing = null;
}

/**
 * Plays a sound for us and, when `mic` is live, mixes it into what the room hears. One at a time:
 * a new sound cuts the previous one, so mashing the board doesn't stack airhorns. Resolves to the
 * sound's length in seconds.
 */
export async function playSound(id: SoundId, mic: LocalAudioTrack | undefined): Promise<number> {
 stopSound();
 const { synth } = SOUNDS[id];
 // Our own copy goes to the picked speaker, like the room cues.
 const monitor = cueContext();
 const voices = [voice(monitor, monitor.destination, synth, MONITOR_LEVEL)];
 const current = { stop: () => voices.forEach((v) => v.stop()) };
 playing = current;
 // A muted mic is muted at the server too, so there's no point mixing into it.
 if (mic && !mic.isMuted) {
  const bus = await busFor(mic);
  // Another sound may have started while the processor was being installed.
  if (bus && playing === current) {
   void (bus.context as AudioContext).resume();
   voices.push(voice(bus.context, bus, synth, 1));
  }
 }
 return voices[0].length;
}
