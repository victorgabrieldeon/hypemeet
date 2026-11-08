import { ConnectionQuality, LocalVideoTrack, RemoteVideoTrack, type Track } from "livekit-client";
import { useEffect, useState } from "react";

const QUALITY: Partial<Record<ConnectionQuality, { bars: number; label: string; tone: string }>> = {
  [ConnectionQuality.Excellent]: { bars: 3, label: "excelente", tone: "scrim text-ink" },
  [ConnectionQuality.Good]: { bars: 2, label: "boa", tone: "scrim text-ink" },
  [ConnectionQuality.Poor]: { bars: 1, label: "ruim", tone: "scrim border-warn/30! px-2.5 text-warn" },
  // Filled like the mic-off badge: danger text on the scrim falls to 2.65:1 over a bright frame.
  [ConnectionQuality.Lost]: {
    bars: 0,
    label: "caiu",
    tone: "border-[1.5px] border-[color-mix(in_srgb,var(--color-danger)_55%,white)] bg-danger px-2.5 text-on-accent",
  },
};

/**
 * Signal-style bars from the quality LiveKit's server scores for each participant, as a chip over a tile; a poor or
 * lost connection also says so in words (Unknown renders nothing).
 */
export function ConnectionBars({ quality }: { quality: ConnectionQuality }) {
  const info = QUALITY[quality];
  if (!info) return null;
  const label = `Conexão ${info.label}`;
  const weak = info.bars < 2;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      // Not scrimClass: its text-ink would beat the tone's. The tone brings the surface and the only text colour.
      className={`inline-flex h-6.5 shrink-0 items-center gap-1.5 rounded-full text-xs font-bold ${weak ? "" : "w-6.5 justify-center"} ${info.tone}`}
    >
      <span className="flex h-2.5 items-end gap-0.5">
        {[0.4, 0.7, 1].map((height, i) => (
          <span
            key={i}
            className={`w-[3px] rounded-[1px] ${i < info.bars ? "bg-current" : "bg-current/25"}`}
            style={{ height: `${height * 100}%` }}
          />
        ))}
      </span>
      {weak && (
        <span>
          <span className="hidden @min-[12rem]:inline">conexão </span>
          {info.label}
        </span>
      )}
    </span>
  );
}

/** What a video track is actually sending (local) or receiving (remote), measured over the last second. */
export interface VideoStats {
  width: number;
  height: number;
  fps: number;
  /** bits per second, all simulcast layers together */
  bitrate: number;
}

interface Layer {
  key: string;
  bytes: number;
  frames: number;
  timestamp: number;
  width: number;
  height: number;
}

async function readLayers(track: Track): Promise<Layer[]> {
  if (track instanceof LocalVideoTrack) {
    return (await track.getSenderStats()).map((s) => ({
      key: s.rid ?? "",
      bytes: s.bytesSent ?? 0,
      frames: s.framesSent ?? 0,
      timestamp: s.timestamp,
      width: s.frameWidth ?? 0,
      height: s.frameHeight ?? 0,
    }));
  }
  if (track instanceof RemoteVideoTrack) {
    const s = await track.getReceiverStats();
    if (!s) return [];
    return [
      {
        key: "",
        bytes: s.bytesReceived ?? 0,
        frames: s.framesDecoded ?? 0,
        timestamp: s.timestamp,
        width: s.frameWidth ?? 0,
        height: s.frameHeight ?? 0,
      },
    ];
  }
  return [];
}

/**
 * Polls WebRTC stats every second while mounted. null until two samples exist. A layer that sent
 * nothing since the last sample is paused (dynacast) and doesn't count; the reported resolution and
 * fps are those of the largest layer still flowing.
 */
export function useVideoStats(track: Track): VideoStats | null {
  const [stats, setStats] = useState<VideoStats | null>(null);
  useEffect(() => {
    let prev = new Map<string, Layer>();
    let cancelled = false;
    const sample = async () => {
      const layers = await readLayers(track).catch(() => []);
      if (cancelled) return;
      let bitrate = 0;
      let top: Omit<VideoStats, "bitrate"> | null = null;
      for (const layer of layers) {
        const before = prev.get(layer.key);
        if (!before || layer.timestamp <= before.timestamp) continue;
        const seconds = (layer.timestamp - before.timestamp) / 1000;
        const bps = ((layer.bytes - before.bytes) * 8) / seconds;
        if (bps <= 0) continue;
        bitrate += bps;
        if (!top || layer.width * layer.height > top.width * top.height)
          top = { width: layer.width, height: layer.height, fps: (layer.frames - before.frames) / seconds };
      }
      if (prev.size > 0) setStats({ width: 0, height: 0, fps: 0, ...top, bitrate });
      prev = new Map(layers.map((l) => [l.key, l]));
    };
    void sample();
    const id = setInterval(sample, 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [track]);
  return stats;
}

const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

export function formatBitrate(bps: number): string {
  return bps >= 1_000_000 ? `${decimal.format(bps / 1_000_000)} Mbps` : `${Math.round(bps / 1000)} kbps`;
}
