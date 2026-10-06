// Screen audio from one app (or one browser tab) on Linux. Electron's loopback there is the whole
// PC, this call included. venmic (Vesktop's PipeWire patchbay) instead builds a virtual mic and
// links only the chosen playback streams into it; the page then records that mic as the screen's
// audio. Firefox-based browsers name each tab's stream after the page title, so a single tab can
// be picked; Chromium names them all "Playback", so there it's the whole browser.

const IS_LINUX = process.platform === "linux";
/** The virtual mic venmic creates; the page finds it by this label. */
const DEVICE_LABEL = "vencord-screen-share";
/** A link the page doesn't claim this soon (old site build, capture failed) is undone. */
const CLAIM_TIMEOUT_MS = 15_000;
/** Stream names that are a title (contain a space), not a generic "Playback"/"playStream". */
const isTitle = (name) => typeof name === "string" && /\s/.test(name.trim());

/**
 * @typedef {{ id: string, app: string, title: string | null }} AudioTarget
 * `title` null = everything the app plays; otherwise one of its streams (a browser tab).
 */

/** @param {{ ownAudioPid: () => number | undefined }} options */
function createAppAudio({ ownAudioPid }) {
  /** undefined = not loaded yet; null = unavailable (not Linux, no PipeWire, load failed). */
  let patchBay;
  /** id → venmic `include` props, for everything listed so far (a paused tab can still be picked). */
  const targets = new Map();
  /** "idle" | "pending" (linked, waiting for the page to claim it) | "claimed" */
  let state = "idle";
  let claimTimer = null;

  /** Loaded on first use: a missing PipeWire must not take the app down. */
  function bay() {
    if (patchBay !== undefined) return patchBay;
    patchBay = null;
    if (!IS_LINUX) return null;
    try {
      const { PatchBay } = require("@vencord/venmic");
      if (PatchBay.hasPipeWire()) patchBay = new PatchBay();
    } catch (error) {
      console.error("per-app screen audio unavailable:", error);
    }
    return patchBay;
  }

  /** Our own playout (the room) and every recording stream, our capture of the virtual mic included. */
  function excluded() {
    const pid = ownAudioPid();
    return [{ "media.class": "Stream/Input/Audio" }, ...(pid ? [{ "application.process.id": String(pid) }] : [])];
  }

  /** What's playing right now, one entry per app plus one per titled stream. Null when unavailable. */
  function list() {
    const patch = bay();
    if (!patch) return null;
    const own = String(ownAudioPid() ?? "");
    /** @type {Map<string, { app: string, titles: Set<string> }>} keyed by binary */
    const apps = new Map();
    for (const node of patch.list()) {
      if (node["media.class"] !== "Stream/Output/Audio" || node["application.process.id"] === own) continue;
      const binary = node["application.process.binary"];
      if (!binary) continue;
      const entry = apps.get(binary) ?? { app: node["application.name"] || binary, titles: new Set() };
      if (isTitle(node["media.name"])) entry.titles.add(node["media.name"]);
      apps.set(binary, entry);
    }
    /** @type {AudioTarget[]} */
    const listed = [];
    for (const [binary, { app, titles }] of apps) {
      const id = `app:${binary}`;
      targets.set(id, [{ "application.process.binary": binary }]);
      listed.push({ id, app, title: null });
      for (const title of titles) {
        const tabId = `tab:${binary}:${title}`;
        targets.set(tabId, [{ "application.process.binary": binary, "media.name": title }]);
        listed.push({ id: tabId, app, title });
      }
    }
    return listed;
  }

  function release() {
    clearTimeout(claimTimer);
    claimTimer = null;
    if (state === "idle") return;
    state = "idle";
    try {
      patchBay?.unlink();
    } catch (error) {
      console.error("unlink failed:", error);
    }
  }

  /** Routes `target` ("system" or an id from the last list()) into the virtual mic. */
  function link(target) {
    const patch = bay();
    if (!patch || state !== "idle") return false;
    const include = target === "system" ? null : targets.get(target);
    if (target !== "system" && !include) return false;
    const ok = patch.link({
      ...(include ? { include } : {}),
      exclude: excluded(),
      mute: false,
      // A tab or app may play to a headset that isn't the default output; still capture it.
      only_default_speakers: false,
    });
    if (!ok) return false;
    state = "pending";
    claimTimer = setTimeout(release, CLAIM_TIMEOUT_MS);
    return true;
  }

  return {
    available: () => !!bay(),
    /** A screen is already sending app audio: there's one virtual mic, so one at a time. */
    busy: () => state !== "idle",
    list,
    link,
    /** The page takes the link it just asked for; returns the mic's label, or null if there's none. */
    claim() {
      if (state !== "pending") return null;
      clearTimeout(claimTimer);
      claimTimer = null;
      state = "claimed";
      return DEVICE_LABEL;
    },
    release,
  };
}

module.exports = { createAppAudio, APP_AUDIO_DEVICE_LABEL: DEVICE_LABEL };
