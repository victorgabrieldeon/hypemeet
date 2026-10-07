import { cueContext } from "./sounds";

/**
 * Sounds of the casino table, synthesised like the room cues (no files to load): effects for what
 * happens at the table, and two looping soundtracks — the lounge track the streamer can put on for
 * the room, and the soap-opera theme of a losing run. Both volumes are each listener's own.
 */

const FX_KEY = "hypemeet:casino-fx";
const MUSIC_KEY = "hypemeet:casino-music";
/** Bus gain at volume 1: effects sit a bit above the room cues, music under the conversation. */
const FX_LEVEL = 0.9;
const MUSIC_LEVEL = 0.55;

function loadVolume(key: string, fallback: number): number {
  const v = Number(localStorage.getItem(key));
  return localStorage.getItem(key) !== null && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
}

export interface CasinoVolumes {
  fx: number;
  music: number;
}

let volumes: CasinoVolumes = { fx: loadVolume(FX_KEY, 0.8), music: loadVolume(MUSIC_KEY, 0.5) };
const volumeListeners = new Set<() => void>();

export const subscribeVolumes = (listener: () => void) => {
  volumeListeners.add(listener);
  return () => void volumeListeners.delete(listener);
};
export const getVolumes = () => volumes;

export function setVolume(kind: keyof CasinoVolumes, value: number) {
  volumes = { ...volumes, [kind]: value };
  localStorage.setItem(kind === "fx" ? FX_KEY : MUSIC_KEY, String(value));
  if (fxBus) fxBus.gain.value = volumes.fx * FX_LEVEL;
  if (musicBus) musicBus.gain.value = volumes.music * MUSIC_LEVEL;
  for (const listener of volumeListeners) listener();
}

let fxBus: GainNode | null = null;
let musicBus: GainNode | null = null;

function fxOut(): { ctx: AudioContext; out: GainNode; t: number } {
  const ctx = cueContext();
  if (!fxBus || fxBus.context !== ctx) {
    fxBus = ctx.createGain();
    fxBus.gain.value = volumes.fx * FX_LEVEL;
    fxBus.connect(ctx.destination);
  }
  return { ctx, out: fxBus, t: ctx.currentTime + 0.01 };
}

function musicOut(): { ctx: AudioContext; out: GainNode } {
  const ctx = cueContext();
  if (!musicBus || musicBus.context !== ctx) {
    musicBus = ctx.createGain();
    musicBus.gain.value = volumes.music * MUSIC_LEVEL;
    musicBus.connect(ctx.destination);
  }
  return { ctx, out: musicBus };
}

// --- building blocks ---

function note(
  ctx: BaseAudioContext,
  out: AudioNode,
  t: number,
  freq: number,
  duration: number,
  peak: number,
  type: OscillatorType = "sine",
  glideTo?: number,
) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t + duration * 0.8);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(peak, t + 0.008);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(amp).connect(out);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

function noise(ctx: BaseAudioContext): AudioBufferSourceNode {
  let buffer = noiseBuffers.get(ctx);
  if (!buffer) {
    buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, buffer);
  }
  const node = ctx.createBufferSource();
  node.buffer = buffer;
  return node;
}

function noiseHit(ctx: BaseAudioContext, out: AudioNode, t: number, duration: number, peak: number, type: BiquadFilterType, freq: number) {
  const src = noise(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(peak, t + 0.004);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  src.connect(filter).connect(amp).connect(out);
  src.start(t, Math.random());
  src.stop(t + duration + 0.02);
}

// --- effects ---

/** Small win: two coins. */
export function coin() {
  const { ctx, out, t } = fxOut();
  note(ctx, out, t, 1318.51, 0.12, 0.12, "square");
  note(ctx, out, t + 0.07, 1975.53, 0.35, 0.12, "square");
}

/** Big win: a run of coins and a bell chord. */
export function jackpot() {
  const { ctx, out, t } = fxOut();
  const run = [1046.5, 1318.51, 1567.98, 2093, 1567.98, 2093, 2637.02];
  run.forEach((f, i) => note(ctx, out, t + i * 0.06, f, 0.14, 0.09, "square"));
  for (const f of [2093, 2637.02, 3135.96]) note(ctx, out, t + run.length * 0.06, f, 1.4, 0.07);
  note(ctx, out, t, 130.81, 0.6, 0.25, "triangle", 65.41);
}

/** Big loss: a funeral bell, struck twice. */
export function toll() {
  const { ctx, out, t } = fxOut();
  for (const strike of [0, 1.3]) {
    // Bells are inharmonic: hum, prime, a minor third and a fifth-ish, all decaying at their own pace.
    for (const [f, peak, decay] of [[110, 0.22, 3], [220, 0.14, 2.4], [261.6, 0.08, 1.8], [330.5, 0.06, 1.4], [557, 0.03, 0.9]] as const) {
      note(ctx, out, t + strike, f, decay, peak);
    }
  }
}

/** Goal or limit hit: a two-tone siren. */
export function siren() {
  const { ctx, out, t } = fxOut();
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  for (let i = 0; i < 6; i++) osc.frequency.setValueAtTime(i % 2 ? 660 : 880, t + i * 0.36);
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 2200;
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(0.09, t + 0.03);
  amp.gain.setValueAtTime(0.09, t + 2.05);
  amp.gain.linearRampToValueAtTime(0, t + 2.2);
  osc.connect(filter).connect(amp).connect(out);
  osc.start(t);
  osc.stop(t + 2.25);
}

/** Tomato hitting the screen. */
export function splat() {
  const { ctx, out, t } = fxOut();
  noiseHit(ctx, out, t, 0.22, 0.35, "lowpass", 900);
  note(ctx, out, t, 180, 0.18, 0.3, "sine", 55);
}

/** Rose landing: a little sparkle. */
export function chime() {
  const { ctx, out, t } = fxOut();
  [1567.98, 2093, 2637.02, 3135.96].forEach((f, i) => note(ctx, out, t + i * 0.05, f, 0.6, 0.05));
}

/** Ritual starting. */
export function gong() {
  const { ctx, out, t } = fxOut();
  noiseHit(ctx, out, t, 0.12, 0.12, "lowpass", 400);
  for (const [f, peak] of [[98, 0.2], [197.5, 0.1], [292, 0.07], [415, 0.04]] as const) note(ctx, out, t, f, 2.8, peak);
}

/** Someone yelled "para!". */
export function bonk() {
  const { ctx, out, t } = fxOut();
  note(ctx, out, t, 330, 0.16, 0.12, "square", 165);
  note(ctx, out, t + 0.12, 247, 0.2, 0.1, "square", 123);
}

/** A pinned comment or a note from the narrator. */
export function pop() {
  const { ctx, out, t } = fxOut();
  note(ctx, out, t, 600, 0.09, 0.12, "sine", 1200);
}

/** "Pagou!": cymbal crash on a kick. */
export function crash() {
  const { ctx, out, t } = fxOut();
  noiseHit(ctx, out, t, 1.6, 0.22, "highpass", 4500);
  note(ctx, out, t, 150, 0.35, 0.4, "sine", 45);
  coin();
}

/** "Não pagou": wah, wah, wah, waaah. */
export function sadTrombone() {
  const { ctx, out, t } = fxOut();
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 1100;
  filter.connect(out);
  [293.66, 277.18, 261.63, 246.94].forEach((f, i) => {
    const s = t + i * 0.42;
    const length = i === 3 ? 1.1 : 0.36;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = f;
    if (i === 3) {
      const vibrato = ctx.createOscillator();
      vibrato.frequency.value = 6;
      const depth = ctx.createGain();
      depth.gain.value = 6;
      vibrato.connect(depth).connect(osc.frequency);
      vibrato.start(s);
      vibrato.stop(s + length);
    }
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, s);
    amp.gain.linearRampToValueAtTime(0.11, s + 0.04);
    amp.gain.setValueAtTime(0.11, s + length - 0.12);
    amp.gain.linearRampToValueAtTime(0, s + length);
    osc.connect(amp).connect(filter);
    osc.start(s);
    osc.stop(s + length + 0.02);
  });
}

/** Snare roll that builds up until stopped; returns the stop. */
export function drumroll(): () => void {
  const { ctx, out, t } = fxOut();
  const src = noise(ctx);
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 2400;
  filter.Q.value = 0.7;
  // A square LFO chops the noise into strokes: gain swings 0 ↔ 1 around a 0.5 offset.
  const strokes = ctx.createGain();
  strokes.gain.value = 0.5;
  const lfo = ctx.createOscillator();
  lfo.type = "square";
  lfo.frequency.value = 17;
  const depth = ctx.createGain();
  depth.gain.value = 0.5;
  lfo.connect(depth).connect(strokes.gain);
  const swell = ctx.createGain();
  swell.gain.setValueAtTime(0.0001, t);
  swell.gain.exponentialRampToValueAtTime(0.05, t + 0.3);
  swell.gain.linearRampToValueAtTime(0.22, t + 14);
  src.connect(filter).connect(strokes).connect(swell).connect(out);
  src.start(t);
  lfo.start(t);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    const now = ctx.currentTime;
    swell.gain.cancelScheduledValues(now);
    swell.gain.setValueAtTime(swell.gain.value, now);
    swell.gain.linearRampToValueAtTime(0, now + 0.08);
    src.stop(now + 0.1);
    lfo.stop(now + 0.1);
  };
}

// --- soundtracks ---

export type MusicKind = "lounge" | "novela";

/** Calls `step` for every 16th note slightly ahead of time, at whatever tempo `bpm` says right now. */
class Loop {
  private timer: ReturnType<typeof setInterval>;
  private nextAt: number;
  private index = 0;
  readonly gain: GainNode;

  constructor(
    private ctx: AudioContext,
    out: AudioNode,
    public bpm: () => number,
    private step: (ctx: AudioContext, out: AudioNode, t: number, index: number, stepLength: number) => void,
  ) {
    this.gain = ctx.createGain();
    this.gain.gain.setValueAtTime(0, ctx.currentTime);
    this.gain.gain.linearRampToValueAtTime(1, ctx.currentTime + 1.2);
    this.gain.connect(out);
    this.nextAt = ctx.currentTime + 0.1;
    this.timer = setInterval(this.schedule, 30);
  }

  private schedule = () => {
    // Fell behind (tab in the background): skip ahead instead of firing a burst of notes.
    if (this.nextAt < this.ctx.currentTime) this.nextAt = this.ctx.currentTime + 0.05;
    while (this.nextAt < this.ctx.currentTime + 0.2) {
      const stepLength = 60 / this.bpm() / 4;
      this.step(this.ctx, this.gain, this.nextAt, this.index++, stepLength);
      this.nextAt += stepLength;
    }
  };

  stop() {
    clearInterval(this.timer);
    const now = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(this.gain.gain.value, now);
    this.gain.gain.linearRampToValueAtTime(0, now + 0.6);
    setTimeout(() => this.gain.disconnect(), 800);
  }
}

/** Dm7 – G7 – Cmaj7 – A7: walking bass, brushed hats, chord stabs on 2 and 4. */
const LOUNGE = [
  { bass: [73.42, 87.31, 110, 130.81], chord: [174.61, 220, 261.63, 329.63] },
  { bass: [98, 123.47, 146.83, 123.47], chord: [174.61, 246.94, 293.66, 349.23] },
  { bass: [65.41, 82.41, 98, 123.47], chord: [164.81, 246.94, 329.63, 392] },
  { bass: [110, 98, 82.41, 69.3], chord: [196, 277.18, 329.63, 392] },
];

function lounge(ctx: AudioContext, out: AudioNode, t: number, index: number, step: number) {
  const bar = LOUNGE[Math.floor(index / 16) % LOUNGE.length]!;
  const pos = index % 16;
  if (pos % 4 === 0) note(ctx, out, t, bar.bass[pos / 4]!, step * 3.6, 0.16, "triangle");
  if (pos % 4 === 2) noiseHit(ctx, out, t, 0.05, 0.035, "highpass", 7000);
  if (pos === 4 || pos === 12) for (const f of bar.chord) note(ctx, out, t, f, step * 2.5, 0.025, "triangle");
  if (pos === 0) note(ctx, out, t, bar.chord[3]! * 2, step * 6, 0.02);
  if (pos % 8 === 0) note(ctx, out, t, 110, 0.18, 0.12, "sine", 45);
}

/** Am – F – C – E: slow piano arpeggios over a string pad. */
const NOVELA = [
  [220, 261.63, 329.63, 440],
  [174.61, 220, 261.63, 349.23],
  [261.63, 329.63, 392, 523.25],
  [164.81, 207.65, 246.94, 329.63],
];

function novela(ctx: AudioContext, out: AudioNode, t: number, index: number, step: number) {
  const chord = NOVELA[Math.floor(index / 16) % NOVELA.length]!;
  const pos = index % 16;
  if (pos % 2 === 0) {
    const arp = [0, 1, 2, 3, 2, 1, 2, 1][pos / 2]!;
    note(ctx, out, t, chord[arp]!, step * 6, 0.07, "triangle");
    note(ctx, out, t, chord[arp]! * 2, step * 3, 0.015);
  }
  if (pos === 0) {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 700;
    filter.connect(out);
    const length = step * 16;
    for (const f of [chord[0]! / 2, chord[1]!, chord[2]!]) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = f;
      osc.detune.value = (Math.random() - 0.5) * 12;
      const amp = ctx.createGain();
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(0.02, t + length * 0.4);
      amp.gain.linearRampToValueAtTime(0, t + length);
      osc.connect(amp).connect(filter);
      osc.start(t);
      osc.stop(t + length + 0.05);
    }
  }
}

let current: { kind: MusicKind; loop: Loop } | null = null;

/** Plays one soundtrack (or none). For the lounge, `bpm` is read every step so it follows the hype. */
export function setMusic(kind: MusicKind | null, bpm: () => number = () => 90) {
  if (current?.kind === kind) {
    current.loop.bpm = bpm;
    return;
  }
  current?.loop.stop();
  current = null;
  if (!kind) return;
  const { ctx, out } = musicOut();
  current = { kind, loop: new Loop(ctx, out, bpm, kind === "lounge" ? lounge : novela) };
}
