import { ConnectionState, Track, type Room } from "livekit-client";
import {
  Blocks,
  Check,
  Copy,
  Link2,
  Megaphone,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Popcorn,
  SmilePlus,
  Users,
  Video,
  VideoOff,
  Volume2,
  WifiOff,
} from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Button, LogoMark, Spinner } from "../components/ui";
import type { RoomInfo } from "../lib/api";
import { formatCode } from "../lib/code";
import { cameraBlocked, inDiscord, screenCaptureBlocked } from "../lib/discord";
import { usePttState } from "../lib/ptt";
import type { RoomChat } from "./chat";
import { ChatPanel } from "./ChatPanel";
import { RoomAudio } from "./media";
import { loadNoiseFilter, loadScreenPrefs, saveNoiseFilter, saveScreenPrefs } from "./devices";
import { DeviceMenu, MenuChevron, MenuSection, MenuToggle, useDismiss } from "./menus";
import {
  buildTiles,
  SCREEN_AUDIO_COPY,
  startScreenShare,
  useRoomVersion,
  useScreenAudioCleanup,
  useSubscriptions,
  useViewingAttribute,
  type TileModel,
} from "./model";
import { canSuppressNoise, useNoiseFilter } from "./noise";
import { PushToTalkSection, usePushToTalk } from "./pushToTalk";
import { InkProvider } from "./ink";
import { ReactionBar, ReactionsProvider, reactionTarget, useReactions } from "./reactions";
import { CastPanel, ScreenPanel } from "./ScreenPanel";
import { castOwnerOf, remotePeople, stopCast } from "./cast";
import { SoundboardPanel } from "./SoundboardPanel";
import { Stage } from "./Stage";
import { sourceKey, useWatchParty, WATCH_TILE_ID } from "./watch";
import { WatchPanel } from "./WatchPanel";
import { WatchPlayer } from "./WatchPlayer";
import { pipFocus, usePipTile, usePipWindow } from "./pip";
import { PipStage } from "./PipStage";
import { PreviewsProvider, type ScreenPreviews } from "./previews";
import { PluginPanel, pluginTileId, PluginView, usePlugins, usersOf } from "./plugins";
import { playCue, useRoomSounds } from "./sounds";

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
  /** Our room token (LiveKit's), for what's opened on our behalf: a built-in plugin's pass. */
  token: string;
  chat: RoomChat;
  previews: ScreenPreviews;
  info: RoomInfo;
  initialDevices: { mic: boolean; camera: boolean };
  onLeave: () => void;
  /** The room's link for "Convidar". Default: this site's /r/<code>. */
  inviteUrl?: string;
  /** Replaces copying the link (the Discord Activity opens Discord's own invite dialog). */
  onInvite?: () => void;
  /** Where screens and the camera can't be captured (the Discord Activity): opens a browser transmitter for us. */
  onCast?: (withCamera: boolean) => Promise<void>;
  /** Where YouTube's player can't load (the Discord Activity): the server's relay of a video. */
  youTubeStream?: (videoId: string) => string;
  /** Discord has the Activity in its picture-in-picture: just one video fills the small window (PipStage). */
  discordPip?: boolean;
  onRejoin: () => void;
}

export function RoomView({ room, token, chat, previews, info, initialDevices, onLeave, onRejoin, inviteUrl, onInvite, onCast, youTubeStream, discordPip = false }: RoomViewProps) {
  useRoomVersion(room);
  useScreenAudioCleanup(room);
  useSubscriptions(room);
  useViewingAttribute(room);
  useRoomSounds(room);
  const local = room.localParticipant;
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"mic" | "camera" | "screen" | null>(null);
  const [screenPrefs, setScreenPrefs] = useState(loadScreenPrefs);
  const [screensOpen, setScreensOpen] = useState(false);
  const screensRef = useRef<HTMLDivElement>(null);
  useDismiss(screensRef, screensOpen, () => setScreensOpen(false));
  const reactions = useReactions(room);
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const reactionsRef = useRef<HTMLDivElement>(null);
  useDismiss(reactionsRef, reactionsOpen, () => setReactionsOpen(false));
  const [soundsOpen, setSoundsOpen] = useState(false);
  const soundsRef = useRef<HTMLDivElement>(null);
  useDismiss(soundsRef, soundsOpen, () => setSoundsOpen(false));
  const watch = useWatchParty(room);
  const [watchOpen, setWatchOpen] = useState(false);
  const watchRef = useRef<HTMLDivElement>(null);
  useDismiss(watchRef, watchOpen, () => setWatchOpen(false));
  // Our copy of the video for a file session, tagged with the source it was opened for.
  const [watchFile, setWatchFile] = useState<{ file: File; key: string } | null>(null);
  const watchKey = watch.party ? sourceKey(watch.party.state.source) : null;
  const watchId = watch.party?.state.id;
  // A session starting (here or by someone else) takes the stage; minimizing it is up to each viewer.
  useEffect(() => {
    if (watchId) setPinnedId(WATCH_TILE_ID);
  }, [watchId]);
  // The session this viewer chose not to follow: no player at all (nothing loads, nothing plays) until they rejoin.
  const [watchSkipped, setWatchSkipped] = useState<string | null>(null);
  const following = !!watchId && watchSkipped !== watchId;
  const leaveWatch = () => {
    setWatchSkipped(watchId ?? null);
    setPinnedId((id) => (id === WATCH_TILE_ID ? null : id));
    setToast({ text: "Você parou de acompanhar. A sessão segue pros outros; pra voltar, é só abrir o tile.", tone: "info" });
  };
  const joinWatch = () => {
    setWatchSkipped(null);
    setPinnedId(WATCH_TILE_ID);
  };
  const plugins = usePlugins(room);
  const activePlugins = plugins.sessions.filter((s) => usersOf(s).length > 0);
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const pluginsRef = useRef<HTMLDivElement>(null);
  useDismiss(pluginsRef, pluginsOpen, () => setPluginsOpen(false));
  const openPlugin = (id: string) => {
    plugins.open(id);
    setPinnedId(pluginTileId(id));
    setPluginsOpen(false);
  };
  const closePlugin = (id: string) => {
    const session = plugins.sessions.find((s) => s.info.id === id);
    // The last one out takes the plugin's state along (Drawspace's board lives only in open browsers).
    if (session && usersOf(session).length <= 1 && !confirm(`Você é o último no ${session.info.name}: fechando, o que não foi salvo se perde. Fechar?`))
      return;
    plugins.close(id);
    setPinnedId((pinned) => (pinned === pluginTileId(id) ? null : pinned));
  };
  const [toast, setToast] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const chatState = useSyncExternalStore(chat.subscribe, chat.getSnapshot);
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(() => chat.setVisible(chatOpen && !discordPip), [chat, chatOpen, discordPip]);

  // Ping for messages nobody is looking at: panel closed or window in the background.
  useEffect(() => chat.onIncoming(() => (!chat.isVisible || document.hidden) && playCue("message")), [chat]);

  const [noiseFilter, setNoiseFilter] = useState(loadNoiseFilter);
  useNoiseFilter(local, noiseFilter, (err) => {
    // Back off so the switch doesn't claim a filter that isn't running.
    setNoiseFilter(false);
    saveNoiseFilter(false);
    setToast({ text: `Não deu pra ativar a supressão de ruído: ${(err as Error)?.message ?? err}`, tone: "error" });
  });
  const ptt = usePttState();
  usePushToTalk(local, ptt, (e) => setToast({ text: deviceError(e, "o microfone"), tone: "error" }));

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
  usePipWindow(tiles, (err) =>
    setToast({ text: `Não deu pra abrir a janela flutuante: ${(err as Error)?.message ?? err}`, tone: "error" }),
  );
  const floatingId = usePipTile();
  // In Discord's picture-in-picture a pinned watch party or plugin keeps the space; otherwise one tile does.
  const pinnedView =
    (pinnedId === WATCH_TILE_ID && !!watch.party && following) ||
    plugins.sessions.some((s) => s.open && pinnedId === pluginTileId(s.info.id));
  const pipTile = discordPip && !pinnedView ? pipFocus(tiles, { floating: floatingId, pinned: pinnedId }) : null;
  const myScreens = tiles.filter(
    (t): t is Extract<TileModel, { kind: "screen" }> => t.kind === "screen" && t.participant === local,
  );
  // What our browser transmitters send, shown as ours (Discord Activity).
  const castScreens = tiles.filter(
    (t): t is Extract<TileModel, { kind: "screen" }> =>
      t.kind === "screen" && castOwnerOf(t.participant) === local.identity,
  );
  const sendingCount = myScreens.length + castScreens.length;
  // The transmitter sending our camera, if any (Discord Activity).
  const castCamera = [...room.remoteParticipants.values()].find(
    (p) => castOwnerOf(p) === local.identity && p.getTrackPublication(Track.Source.Camera),
  );
  const reactionTargetTile = reactionTarget(tiles, pinnedId);
  const micOn = local.isMicrophoneEnabled;
  const cameraOn = local.isCameraEnabled || !!castCamera;
  const state = room.state;

  async function toggleMic() {
    setBusy("mic");
    try {
      await local.setMicrophoneEnabled(!micOn);
      playCue(micOn ? "mute" : "unmute");
    } catch (e) {
      setToast({ text: deviceError(e, "o microfone"), tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function toggleCamera() {
    if (castCamera)
      return stopCast(local, castCamera, castCamera.getTrackPublication(Track.Source.Camera)!.trackSid).catch(() =>
        setToast({ text: "Não deu pra desligar a câmera", tone: "error" }),
      );
    if (cameraBlocked && onCast) return startCast("camera");
    setBusy("camera");
    try {
      await local.setCameraEnabled(!cameraOn);
    } catch (e) {
      // Discord can deny it past what the iframe's policy says: same way out.
      if (inDiscord && onCast && (e as DOMException)?.name === "NotAllowedError") return await startCast("camera");
      setToast({ text: deviceError(e, "a câmera"), tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function addScreen() {
    setBusy("screen");
    try {
      const { audio } = await startScreenShare(local, screenPrefs);
      if (screenPrefs.audio && !audio)
        setToast({
          tone: "info",
          text: SCREEN_AUDIO_COPY.missing,
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

  async function startCast(kind: "screen" | "camera") {
    if (!onCast) return;
    setBusy(kind);
    try {
      await onCast(kind === "camera");
    } catch (e) {
      setToast({ text: `Não deu pra abrir o navegador: ${(e as Error).message}`, tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  function stopCastScreen(screen: Extract<TileModel, { kind: "screen" }> | "all") {
    const targets =
      screen === "all"
        ? [...new Set(castScreens.map((s) => s.participant))].map((t) => stopCast(local, t, "all"))
        : [stopCast(local, screen.participant, screen.video.trackSid)];
    Promise.all(targets).catch(() => setToast({ text: "Não deu pra parar a transmissão", tone: "error" }));
  }

  async function copy(kind: "code" | "link") {
    const text = kind === "code" ? formatCode(info.code) : (inviteUrl ?? `${location.origin}/r/${info.code}`);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
    } catch {
      setToast({ text: `Copie manualmente: ${text}`, tone: "info" });
    }
  }

  const participantCount = remotePeople(room).length + 1;
  const hasRemoteScreenAudio = [...room.remoteParticipants.values()].some((p) =>
    [...p.audioTrackPublications.values()].some((pub) => pub.source === Track.Source.ScreenShareAudio),
  );

  return (
    <div className={`flex h-full flex-col bg-canvas ${discordPip ? "" : "gap-3 p-3 sm:gap-4 sm:p-4"}`}>
      <RoomAudio room={room} />

      <header className={`flex items-center justify-between gap-3 ${discordPip ? "hidden" : ""}`}>
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
          <Button variant="primary" className="type-link-sm h-10 px-4" onClick={onInvite ?? (() => copy("link"))}>
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

      <ReactionsProvider value={reactions}>
        <div className="relative flex min-h-0 flex-1 gap-3">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
            {/* Outside the stage so pinning/minimizing never reloads it; hidden, it keeps playing. */}
            {watch.party && watchKey && following && (
              <WatchPlayer
                key={`${watch.party.state.id}:${watchKey}`}
                party={watch.party}
                watch={watch}
                file={watchFile?.key === watchKey ? watchFile.file : null}
                onPickFile={(file) => setWatchFile({ file, key: watchKey })}
                youTubeStream={youTubeStream}
                onCastTab={inDiscord && onCast ? () => void startCast("screen") : undefined}
                onMinimize={() => setPinnedId(null)}
                onLeave={leaveWatch}
                onError={(text) => setToast({ text, tone: "error" })}
                className={pinnedId === WATCH_TILE_ID ? "min-h-0 flex-1" : "hidden"}
              />
            )}
            {plugins.sessions
              .filter((s) => s.open)
              .map((session) => (
                <PluginView
                  key={session.info.id}
                  room={room}
                  info={info}
                  token={token}
                  session={session}
                  onMinimize={() => setPinnedId(null)}
                  onClose={() => closePlugin(session.info.id)}
                  onToast={(text, tone) => setToast({ text, tone })}
                  className={pinnedId === pluginTileId(session.info.id) ? "min-h-0 flex-1" : "hidden"}
                />
              ))}
            {discordPip ? (
              !pinnedView && <PipStage tile={pipTile} />
            ) : (
              <InkProvider room={room}>
                <PreviewsProvider previews={previews}>
                  <Stage
                    tiles={tiles}
                    watch={watch.party}
                    watchJoined={following}
                    plugins={activePlugins}
                    pinnedId={pinnedId}
                    onPin={(id) => {
                      const plugin = activePlugins.find((p) => pluginTileId(p.info.id) === id);
                      if (plugin && !plugin.open) return openPlugin(plugin.info.id);
                      if (id === WATCH_TILE_ID && !following) return joinWatch();
                      setPinnedId(id);
                    }}
                  />
                </PreviewsProvider>
              </InkProvider>
            )}
          </div>
          <ChatPanel
            chat={chat}
            state={chatState}
            open={chatOpen && !discordPip}
            onClose={() => setChatOpen(false)}
            onError={(text) => setToast({ text, tone: "error" })}
          />
        </div>
      </ReactionsProvider>

      <footer
        className={`relative mx-auto flex items-center gap-2 rounded-full border border-line bg-panel p-2 shadow-float sm:gap-3 sm:p-2.5 ${discordPip ? "hidden" : ""}`}
      >
        {/* In the Activity the voice is the Discord channel's. */}
        {!inDiscord && (
          <div className="relative">
            <ControlButton on={micOn} busy={busy === "mic"} onClick={toggleMic} label={micOn ? "Desligar microfone" : ptt?.enabled && ptt.binding ? `Ligar microfone (ou segure ${ptt.binding})` : "Ligar microfone"}>
              {micOn ? <Mic className="size-5" /> : <MicOff className="size-5" />}
            </ControlButton>
            <MenuChevron label="Microfone e saída de áudio">
              {(close) => (
                <>
                  <DeviceMenu
                    room={room}
                    kinds={["audioinput", "audiooutput"]}
                    close={close}
                    onError={(text) => setToast({ text, tone: "error" })}
                  />
                  {canSuppressNoise && (
                    <MenuSection title="Processamento">
                      <MenuToggle
                        label="Supressão de ruído"
                        hint="Corta teclado, ventilador e barulho de fundo"
                        checked={noiseFilter}
                        onChange={(on) => {
                          setNoiseFilter(on);
                          saveNoiseFilter(on);
                        }}
                      />
                    </MenuSection>
                  )}
                  {ptt && <PushToTalkSection ptt={ptt} />}
                </>
              )}
            </MenuChevron>
          </div>
        )}
        <div className="relative">
          <ControlButton
            on={cameraOn}
            busy={busy === "camera"}
            onClick={toggleCamera}
            label={cameraOn ? "Desligar câmera" : cameraBlocked ? "Ligar câmera pelo navegador" : "Ligar câmera"}
          >
            {cameraOn ? <Video className="size-5" /> : <VideoOff className="size-5" />}
          </ControlButton>
          {/* With the transmitter, the camera is picked in the browser. */}
          {!cameraBlocked && (
            <MenuChevron label="Escolher câmera">
              {(close) => (
                <DeviceMenu room={room} kinds={["videoinput"]} close={close} onError={(text) => setToast({ text, tone: "error" })} />
              )}
            </MenuChevron>
          )}
        </div>
        {/* `contents`, not `relative`: the panel anchors to the footer so it stays centred on narrow screens. */}
        <div ref={screensRef} className="contents">
          <ControlButton
            tone="accent"
            on={sendingCount > 0}
            expanded={screensOpen}
            onClick={() => setScreensOpen(!screensOpen)}
            label="Transmissões de tela"
          >
            <MonitorUp className="size-5" />
            {sendingCount > 0 && (
              <span className="absolute -top-1 -right-1 grid size-5 place-items-center rounded-full bg-ink text-[11px] font-bold text-ink-dark ring-2 ring-panel">
                {sendingCount}
              </span>
            )}
          </ControlButton>
          {screensOpen &&
            (screenCaptureBlocked && onCast ? (
              <CastPanel
                screens={castScreens}
                starting={busy === "screen"}
                onStart={() => void startCast("screen")}
                onStop={stopCastScreen}
              />
            ) : (
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
            ))}
        </div>
        {/* Stays open after a pick so you can spam reactions; anchored to the footer like the screens panel. */}
        <div ref={reactionsRef} className="contents">
          <ControlButton
            tone="plain"
            on={reactionsOpen}
            expanded={reactionsOpen}
            onClick={() => setReactionsOpen(!reactionsOpen)}
            label="Reagir"
          >
            <SmilePlus className="size-5" />
          </ControlButton>
          {reactionsOpen && reactionTargetTile && (
            <div className="absolute bottom-full left-1/2 z-40 mb-3 max-w-[calc(100vw-1.5rem)] -translate-x-1/2 animate-pop rounded-lg bg-panel p-2 shadow-float ring-1 ring-line">
              <ReactionBar target={reactionTargetTile} onReact={(emoji) => reactions.send(emoji, reactionTargetTile.id)} />
            </div>
          )}
        </div>
        <div ref={watchRef} className="contents">
          <ControlButton
            tone="plain"
            on={!!watch.party || watchOpen}
            expanded={watchOpen}
            onClick={() => setWatchOpen(!watchOpen)}
            label="Assistir junto"
          >
            <Popcorn className="size-5" />
          </ControlButton>
          {watchOpen && (
            <WatchPanel
              watch={watch}
              following={following}
              onJoin={joinWatch}
              onLeave={leaveWatch}
              onFileChosen={(file) =>
                setWatchFile({ file, key: sourceKey({ kind: "file", name: file.name, size: file.size }) })
              }
              onCastTab={inDiscord && onCast ? () => void startCast("screen") : undefined}
              onDone={() => setWatchOpen(false)}
              onError={(text) => setToast({ text, tone: "error" })}
            />
          )}
        </div>
        {/* The soundboard plays into the mic, which the Activity doesn't have. */}
        {!inDiscord && (
          <div ref={soundsRef} className="contents">
            <ControlButton
              tone="plain"
              on={soundsOpen}
              expanded={soundsOpen}
              onClick={() => setSoundsOpen(!soundsOpen)}
              label="Soundboard"
            >
              <Megaphone className="size-5" />
            </ControlButton>
            {soundsOpen && (
              <SoundboardPanel
                mic={local.getTrackPublication(Track.Source.Microphone)?.audioTrack}
                micOn={micOn}
                onEnableMic={() => void toggleMic()}
                onError={(text) => setToast({ text, tone: "error" })}
              />
            )}
          </div>
        )}
        {plugins.sessions.length > 0 && (
          <div ref={pluginsRef} className="contents">
            <ControlButton
              tone="plain"
              on={pluginsOpen || plugins.sessions.some((s) => s.open)}
              expanded={pluginsOpen}
              onClick={() => setPluginsOpen(!pluginsOpen)}
              label="Plugins"
            >
              <Blocks className="size-5" />
            </ControlButton>
            {pluginsOpen && <PluginPanel plugins={plugins} onOpen={openPlugin} onClose={closePlugin} />}
          </div>
        )}
        <ControlButton
          tone="plain"
          on={chatOpen}
          expanded={chatOpen}
          onClick={() => setChatOpen(!chatOpen)}
          label={chatOpen ? "Fechar chat" : "Abrir chat"}
        >
          <MessageSquare className="size-5" />
          {!chatOpen && chatState.unread > 0 && (
            <span className="absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-blurple px-1 text-[11px] font-bold text-ink ring-2 ring-panel">
              {chatState.unread > 9 ? "9+" : chatState.unread}
            </span>
          )}
        </ControlButton>
        <button
          onClick={() => {
            playCue("leave");
            onLeave();
          }}
          className="type-link ml-1 flex h-12 items-center gap-2 rounded-full bg-danger px-4 text-ink transition duration-200 ease-out-expo hover:brightness-110 active:scale-95 sm:ml-2 sm:h-14 sm:px-6"
          aria-label="Sair da sala"
        >
          <PhoneOff className="size-5" />
          <span className="hidden sm:inline">Sair</span>
        </button>
      </footer>

      {hasRemoteScreenAudio && tiles.length > 0 && !discordPip && (
        <p className="-mt-1 text-center text-xs text-soft/80">
          Passe o mouse numa tela ou pessoa para ajustar o volume — só muda pra você.
        </p>
      )}

      {toast && (
        <div
          role="status"
          className={`fixed ${discordPip ? "bottom-2" : "bottom-28"} left-1/2 z-50 w-[min(92vw,30rem)] -translate-x-1/2 animate-fade-in rounded-lg px-4 py-3 text-sm shadow-float ${toast.tone === "error" ? "bg-danger text-ink" : "bg-surface text-ink"
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
