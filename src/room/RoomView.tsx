import { ConnectionState, Track, type Room } from "livekit-client";
import {
  AudioLines,
  Check,
  Copy,
  Link2,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Users,
  Video,
  VideoOff,
  Volume2,
  WifiOff,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, LogoMark, Spinner } from "../components/ui";
import type { RoomInfo } from "../lib/api";
import { formatCode } from "../lib/code";
import { RoomAudio } from "./media";
import { loadScreenPrefs, saveScreenPrefs } from "./devices";
import { DeviceAudioMenu, DeviceMenu, MENU_PANEL_CLASS, MenuChevron, useDismiss } from "./menus";
import {
  buildTiles,
  deviceAudioPublication,
  startDeviceAudio,
  startScreenShare,
  stopDeviceAudio,
  useRoomVersion,
  useScreenAudioCleanup,
  type TileModel,
} from "./model";
import { ScreenPanel } from "./ScreenPanel";
import { Stage } from "./Stage";

function deviceError(err: unknown, what: string): string {
  const name = (err as DOMException)?.name;
  if (name === "NotAllowedError") return `Permissão negada para ${what}. Libere no cadeado da barra de endereço.`;
  if (name === "NotFoundError") return `Nenhum(a) ${what} encontrado(a).`;
  if (name === "NotReadableError") return `${what} está em uso por outro app.`;
  return `Não deu pra ativar ${what}: ${(err as Error)?.message ?? err}`;
}

function ControlButton({
  on,
  onClick,
  label,
  busy,
  expanded,
  children,
  tone = "toggle",
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  busy?: boolean;
  /** Set when the button toggles a popover. */
  expanded?: boolean;
  children: ReactNode;
  tone?: "toggle" | "accent" | "plain";
}) {
  // accent = screen share, the room's main action: lit outline until you're sharing, then solid Blurple.
  // plain = optional extras: off is just idle (not an alarm), on is solid Blurple.
  const style =
    tone === "accent"
      ? on
        ? "bg-blurple text-ink hover:brightness-110"
        : "bg-surface-hi text-ink ring-1 ring-blurple/50 hover:bg-blurple/25"
      : tone === "plain"
        ? on
          ? "bg-blurple text-ink hover:brightness-110"
          : "bg-surface text-ink hover:bg-surface-hi"
        : on
          ? "bg-surface text-ink hover:bg-surface-hi"
          : "bg-danger/20 text-danger hover:bg-danger/30";
  return (
    <button
      onClick={onClick}
      disabled={busy}
      aria-label={label}
      aria-expanded={expanded}
      title={label}
      className={`relative grid size-12 place-items-center rounded-full transition duration-200 ease-out-expo active:scale-95 disabled:opacity-60 sm:size-14 ${style}`}
    >
      {busy ? <Spinner className="size-5" /> : children}
    </button>
  );
}

interface RoomViewProps {
  room: Room;
  info: RoomInfo;
  initialDevices: { mic: boolean; camera: boolean };
  onLeave: () => void;
  onRejoin: () => void;
}

export function RoomView({ room, info, initialDevices, onLeave, onRejoin }: RoomViewProps) {
  useRoomVersion(room);
  useScreenAudioCleanup(room);
  const local = room.localParticipant;
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"mic" | "camera" | "screen" | "deviceAudio" | null>(null);
  const [screenPrefs, setScreenPrefs] = useState(loadScreenPrefs);
  const [screensOpen, setScreensOpen] = useState(false);
  const screensRef = useRef<HTMLDivElement>(null);
  useDismiss(screensRef, screensOpen, () => setScreensOpen(false));
  const [deviceAudioOpen, setDeviceAudioOpen] = useState(false);
  const deviceAudioRef = useRef<HTMLDivElement>(null);
  useDismiss(deviceAudioRef, deviceAudioOpen, () => setDeviceAudioOpen(false));
  const [toast, setToast] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(null), 1600);
    return () => clearTimeout(id);
  }, [copied]);

  // Turn on the devices chosen in the lobby once (guarded against StrictMode's double effect).
  const devicesApplied = useRef(false);
  useEffect(() => {
    if (devicesApplied.current) return;
    devicesApplied.current = true;
    if (initialDevices.mic)
      local.setMicrophoneEnabled(true).catch((e) => setToast({ text: deviceError(e, "o microfone"), tone: "error" }));
    if (initialDevices.camera)
      local.setCameraEnabled(true).catch((e) => setToast({ text: deviceError(e, "a câmera"), tone: "error" }));
  }, [local, initialDevices]);

  const tiles = buildTiles(room);
  const myScreens = tiles.filter(
    (t): t is Extract<TileModel, { kind: "screen" }> => t.kind === "screen" && t.participant === local,
  );
  const micOn = local.isMicrophoneEnabled;
  const cameraOn = local.isCameraEnabled;
  const deviceAudioId = deviceAudioPublication(local)?.track?.mediaStreamTrack.getSettings().deviceId;
  const state = room.state;

  async function toggleMic() {
    setBusy("mic");
    try {
      await local.setMicrophoneEnabled(!micOn);
    } catch (e) {
      setToast({ text: deviceError(e, "o microfone"), tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function toggleCamera() {
    setBusy("camera");
    try {
      await local.setCameraEnabled(!cameraOn);
    } catch (e) {
      setToast({ text: deviceError(e, "a câmera"), tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function addScreen() {
    setBusy("screen");
    try {
      const withAudio = await startScreenShare(local, screenPrefs);
      if (screenPrefs.audio && !withAudio)
        setToast({
          tone: "info",
          text: "Tela compartilhada sem som. Pra mandar áudio, marque “Compartilhar áudio” no seletor (no Linux/macOS só funciona compartilhando uma aba).",
        });
    } catch (e) {
      const name = (e as DOMException)?.name;
      // User closed the picker: not an error.
      if (name !== "NotAllowedError" && name !== "AbortError")
        setToast({ text: `Não deu pra compartilhar a tela: ${(e as Error).message}`, tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function pickDeviceAudio(deviceId: string) {
    setDeviceAudioOpen(false);
    setBusy("deviceAudio");
    try {
      await startDeviceAudio(local, deviceId);
    } catch (e) {
      setToast({ text: deviceError(e, "o dispositivo de áudio"), tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function copy(kind: "code" | "link") {
    const text = kind === "code" ? formatCode(info.code) : `${location.origin}/r/${info.code}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
    } catch {
      setToast({ text: `Copie manualmente: ${text}`, tone: "info" });
    }
  }

  const participantCount = room.remoteParticipants.size + 1;
  const hasRemoteScreenAudio = [...room.remoteParticipants.values()].some((p) =>
    [...p.audioTrackPublications.values()].some((pub) => pub.source === Track.Source.ScreenShareAudio),
  );

  return (
    <div className="flex h-full flex-col gap-3 bg-canvas p-3 sm:gap-4 sm:p-4">
      <RoomAudio room={room} />

      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <LogoMark />
          <div className="min-w-0">
            <h1 className="truncate font-display text-base font-bold sm:text-lg">{info.name}</h1>
            <button
              onClick={() => copy("code")}
              className="flex items-center gap-1.5 rounded-xs font-mono text-xs tracking-widest text-soft transition hover:text-ink"
              title="Copiar código"
            >
              {formatCode(info.code)}
              {copied === "code" ? <Check className="size-3 text-ink" /> : <Copy className="size-3" />}
            </button>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="type-link-sm flex h-10 items-center gap-1.5 rounded-lg bg-surface px-3 text-soft">
            <Users className="size-4" /> {participantCount}
          </span>
          <Button variant="primary" className="type-link-sm h-10 px-4" onClick={() => copy("link")}>
            {copied === "link" ? <Check className="size-4" /> : <Link2 className="size-4" />}
            <span className="hidden sm:inline">{copied === "link" ? "Link copiado" : "Convidar"}</span>
          </Button>
        </div>
      </header>

      {state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting ? (
        <div className="type-link-sm flex items-center justify-center gap-2 rounded-sm bg-surface py-2.5 text-soft">
          <Spinner className="size-4" /> Reconectando…
        </div>
      ) : null}

      {!room.canPlaybackAudio && (
        <button
          onClick={() => void room.startAudio()}
          className="type-link-sm flex items-center justify-center gap-2 rounded-sm bg-blurple py-2.5 transition hover:brightness-110"
        >
          <Volume2 className="size-4" /> O navegador bloqueou o som — clique para ativar
        </button>
      )}

      <Stage tiles={tiles} pinnedId={pinnedId} onPin={setPinnedId} />

      <footer className="relative mx-auto flex items-center gap-2 rounded-full border border-line bg-panel p-2 shadow-float sm:gap-3 sm:p-2.5">
        <div className="relative">
          <ControlButton on={micOn} busy={busy === "mic"} onClick={toggleMic} label={micOn ? "Desligar microfone" : "Ligar microfone"}>
            {micOn ? <Mic className="size-5" /> : <MicOff className="size-5" />}
          </ControlButton>
          <MenuChevron label="Microfone e saída de áudio">
            {(close) => (
              <DeviceMenu
                room={room}
                kinds={["audioinput", "audiooutput"]}
                close={close}
                onError={(text) => setToast({ text, tone: "error" })}
              />
            )}
          </MenuChevron>
        </div>
        <div className="relative">
          <ControlButton
            on={cameraOn}
            busy={busy === "camera"}
            onClick={toggleCamera}
            label={cameraOn ? "Desligar câmera" : "Ligar câmera"}
          >
            {cameraOn ? <Video className="size-5" /> : <VideoOff className="size-5" />}
          </ControlButton>
          <MenuChevron label="Escolher câmera">
            {(close) => (
              <DeviceMenu room={room} kinds={["videoinput"]} close={close} onError={(text) => setToast({ text, tone: "error" })} />
            )}
          </MenuChevron>
        </div>
        {/* `contents`, not `relative`: the panel anchors to the footer so it stays centred on narrow screens. */}
        <div ref={screensRef} className="contents">
          <ControlButton
            tone="accent"
            on={myScreens.length > 0}
            expanded={screensOpen}
            onClick={() => setScreensOpen(!screensOpen)}
            label="Transmissões de tela"
          >
            <MonitorUp className="size-5" />
            {myScreens.length > 0 && (
              <span className="absolute -top-1 -right-1 grid size-5 place-items-center rounded-full bg-ink text-[11px] font-bold text-ink-dark ring-2 ring-panel">
                {myScreens.length}
              </span>
            )}
          </ControlButton>
          {screensOpen && (
            <ScreenPanel
              screens={myScreens}
              prefs={screenPrefs}
              onPrefsChange={(prefs) => {
                setScreenPrefs(prefs);
                saveScreenPrefs(prefs);
              }}
              starting={busy === "screen"}
              onStart={() => void addScreen()}
              onError={(text) => setToast({ text, tone: "error" })}
            />
          )}
        </div>
        <div ref={deviceAudioRef} className="relative">
          <ControlButton
            tone="plain"
            on={deviceAudioId !== undefined}
            busy={busy === "deviceAudio"}
            expanded={deviceAudioOpen}
            onClick={() => setDeviceAudioOpen(!deviceAudioOpen)}
            label="Transmitir áudio do PC"
          >
            <AudioLines className="size-5" />
          </ControlButton>
          {deviceAudioOpen && (
            <div role="menu" className={MENU_PANEL_CLASS}>
              <DeviceAudioMenu
                room={room}
                activeId={deviceAudioId}
                onPick={(deviceId) => void pickDeviceAudio(deviceId)}
                onStop={() => {
                  setDeviceAudioOpen(false);
                  void stopDeviceAudio(local);
                }}
              />
            </div>
          )}
        </div>
        <button
          onClick={onLeave}
          className="type-link ml-1 flex h-12 items-center gap-2 rounded-full bg-danger px-4 text-ink transition duration-200 ease-out-expo hover:brightness-110 active:scale-95 sm:ml-2 sm:h-14 sm:px-6"
          aria-label="Sair da sala"
        >
          <PhoneOff className="size-5" />
          <span className="hidden sm:inline">Sair</span>
        </button>
      </footer>

      {hasRemoteScreenAudio && tiles.length > 0 && (
        <p className="-mt-1 text-center text-xs text-soft/80">
          Passe o mouse numa tela ou pessoa para ajustar o volume — só muda pra você.
        </p>
      )}

      {toast && (
        <div
          role="status"
          className={`fixed bottom-28 left-1/2 z-50 w-[min(92vw,30rem)] -translate-x-1/2 animate-fade-in rounded-lg px-4 py-3 text-sm shadow-float ${toast.tone === "error" ? "bg-danger text-ink" : "bg-surface text-ink"
            }`}
          onClick={() => setToast(null)}
        >
          {toast.text}
        </div>
      )}

      {state === ConnectionState.Disconnected && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <div className="flex w-full max-w-sm animate-pop flex-col items-center gap-5 rounded-xl bg-canvas p-8 text-center shadow-float sm:p-10">
            <div className="grid size-14 place-items-center rounded-lg bg-danger/20 text-danger">
              <WifiOff className="size-7" />
            </div>
            <div>
              <h2 className="type-heading-sm">Você saiu da sala</h2>
              <p className="mt-1.5 text-soft">A conexão caiu ou foi encerrada.</p>
            </div>
            <div className="flex w-full gap-2">
              <Button className="flex-1" onClick={onLeave}>
                Início
              </Button>
              <Button className="flex-1" variant="primary" onClick={onRejoin}>
                Reentrar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
