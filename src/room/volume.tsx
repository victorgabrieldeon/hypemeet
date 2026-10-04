import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export interface VolumeSetting {
  /** 0–2; values above 1 boost through the Web Audio gain node (room uses webAudioMix). */
  volume: number;
  muted: boolean;
}

export const MAX_VOLUME = 2;
const DEFAULT: VolumeSetting = { volume: 1, muted: false };

interface VolumeStore {
  get(key: string): VolumeSetting;
  set(key: string, patch: Partial<VolumeSetting>): void;
}

const VolumeContext = createContext<VolumeStore | null>(null);

/** Per-listener volume preferences. Local only: changing them never affects what others hear. */
export function VolumeProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Map<string, VolumeSetting>>(() => new Map());
  const set = useCallback((key: string, patch: Partial<VolumeSetting>) => {
    setSettings((prev) => new Map(prev).set(key, { ...(prev.get(key) ?? DEFAULT), ...patch }));
  }, []);
  const store = useMemo<VolumeStore>(() => ({ get: (key) => settings.get(key) ?? DEFAULT, set }), [settings, set]);
  return <VolumeContext.Provider value={store}>{children}</VolumeContext.Provider>;
}

export function useVolumes(): VolumeStore {
  const store = useContext(VolumeContext);
  if (!store) throw new Error("useVolumes outside VolumeProvider");
  return store;
}
