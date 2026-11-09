import { ConnectionState, DisconnectReason, RoomEvent, Track, type Participant, type Room } from "livekit-client";
import {
  Blocks,
  Check,
  Copy,
  Ellipsis,
  Megaphone,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Popcorn,
  SmilePlus,
  UserPlus,
  Users,
  Video,
  VideoOff,
  Volume2,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useReducer, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useShell } from "../components/AppShell";
import { Avatar, Button, cardClass, chipClass, countClass, kbdClass, LogoMark, Spinner } from "../components/ui";
import type { Moderation, RoomInfo } from "../lib/api";
import { formatCode } from "../lib/code";
import { assignPersonColors } from "../lib/color";
import { cameraBlocked, inDiscord, screenCaptureBlocked } from "../lib/discord";
import { usePttState } from "../lib/ptt";
import type { RoomChat } from "./chat";
import { ChatPanel } from "./ChatPanel";
import { RoomAudio } from "./media";
import { loadNoiseFilter, loadScreenPrefs, saveNoiseFilter, saveScreenPrefs } from "./devices";
import { DeviceMenu, MenuChevron, MenuSection, MenuToggle, useDismiss } from "./menus";
import {
  buildTiles,
  discordAvatar,
  nameOf,
  SCREEN_AUDIO_COPY,
  startScreenShare,
  useRoomVersion,
  useScreenAudioCleanup,
  useSubscriptions,
  useViewingAttribute,
  type TileModel,
} from "./model";
import { canSuppressNoise, useNoiseFilter } from "./noise";
import { mayPublish, PeoplePanel } from "./People";
import { PushToTalkSection, usePushToTalk } from "./pushToTalk";
import { InkProvider } from "./ink";
import { ReactionBar, ReactionsProvider, reactionTarget, useReactions } from "./reactions";
import { CastPanel, ScreenPanel } from "./ScreenPanel";
import { castOwnerOf, remotePeople, stopCast } from "./cast";
import { SoundboardPanel } from "./SoundboardPanel";
import { Stage } from "./Stage";
import { byJoinOrder, sourceKey, useWatchParty, WATCH_TILE_ID } from "./watch";
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
  disabled,
  expanded,
  children,
  tone = "toggle",
  className = "",
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  busy?: boolean;
  disabled?: boolean;
  /** Set when the button toggles a popover. */
  expanded?: boolean;
  children: ReactNode;
  tone?: "toggle" | "plain" | "neutral";
  className?: string;
}) {
  // toggle = the mic: off is muted, which is worth a danger tint.
  // plain = sharing and the extras: off is just idle, on (sending, panel open) is solid grape.
  // neutral = the camera: off is a normal state, not an alarm, so it only dims the icon.
  const style =
    tone === "plain" && on
      ? "border-accent-hi bg-accent text-on-accent hover:bg-accent-hi"
      : tone === "toggle" && !on
        ? "border-[color-mix(in_srgb,var(--color-danger)_40%,var(--color-surface))] bg-[color-mix(in_srgb,var(--color-danger)_14%,var(--color-surface))] text-danger hover:bg-[color-mix(in_srgb,var(--color-danger)_22%,var(--color-surface))]"
        : `border-line bg-surface hover:bg-surface-hi ${tone === "neutral" && !on ? "text-soft hover:text-ink" : "text-ink"}`;
  return (
    <button
      onClick={onClick}
      disabled={busy || disabled}
      aria-label={label}
      aria-expanded={expanded}
      title={label}
      className={`relative grid size-12 shrink-0 place-items-center rounded-full border-2 shadow-sticker transition duration-200 ease-out-expo hover:-translate-y-px active:translate-y-px active:shadow-none disabled:translate-y-0 disabled:opacity-60 md:size-14 ${style} ${className}`}
    >
      {busy ? <Spinner className="size-5" /> : children}
    </button>
  );
}

/** One way to invite from "Convidar"; a returned string gets copied. */
export interface InviteOption {
  label: string;
  icon: LucideIcon;
  run: () => Promise<string | void>;
}

interface RoomViewProps {
  room: Room;
  /** Our room token (LiveKit's), for what's opened on our behalf: a plugin's pass. */
  token: string;
  chat: RoomChat;
  previews: ScreenPreviews;
  info: RoomInfo;
  initialDevices: { mic: boolean; camera: boolean };
  onLeave: () => void;
  /** Turns "Convidar" into a menu of these. Default: copy this site's /r/<code>. */
  invites?: InviteOption[];
  /** What our Discord permissions let us do to others here (a Discord channel's room with the bot). */
  moderation?: Moderation;
  /** Where screens and the camera can't be captured (the Discord Activity): opens a browser transmitter for us. */
  onCast?: (withCamera: boolean) => Promise<void>;
  /** Where YouTube's player can't load (the Discord Activity): the server's relay of a video. */
  youTubeStream?: (videoId: string) => string;
  /** Discord has the Activity in its picture-in-picture: just one video fills the small window (PipStage). */
  discordPip?: boolean;
  onRejoin: () => void;
}

export function RoomView({ room, token, chat, previews, info, initialDevices, onLeave, onRejoin, invites, moderation, onCast, youTubeStream, discordPip = false }: RoomViewProps) {
  useRoomVersion(room);
  useScreenAudioCleanup(room);
  useSubscriptions(room);
  useViewingAttribute(room);
  useRoomSounds(room);
  const shell = useShell();
  const local = room.localParticipant;
  const canSpeak = mayPublish(local.permissions, Track.Source.Microphone);
  const canVideo = mayPublish(local.permissions, Track.Source.Camera);
  const canScreen = mayPublish(local.permissions, Track.Source.ScreenShare);
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
  // Phones: the extras fold into "Mais", whose picks open the same popovers as their dock buttons.
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  useDismiss(moreRef, moreOpen, () => setMoreOpen(false));
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
  const [peopleOpen, setPeopleOpen] = useState(false);
  const peopleRef = useRef<HTMLDivElement>(null);
  useDismiss(peopleRef, peopleOpen, () => setPeopleOpen(false));
  const [invitesOpen, setInvitesOpen] = useState(false);
  const [inviting, setInviting] = useState(false);
  const invitesRef = useRef<HTMLDivElement>(null);
  useDismiss(invitesRef, invitesOpen, () => setInvitesOpen(false));
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
  usePushToTalk(local, canSpeak ? ptt : null, (e) => setToast({ text: deviceError(e, "o microfone"), tone: "error" }));

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

  // useRoomVersion doesn't follow permissions: re-render on them here, and react to our own mic being taken or given back.
  const [, bumpPermissions] = useReducer((n: number) => n + 1, 0);
  const [disconnectReason, setDisconnectReason] = useState<DisconnectReason>();
  useEffect(() => {
    const onPermissions = (prev: Participant["permissions"], participant: Participant) => {
      bumpPermissions();
      // A connection's first permissions come without previous ones: nothing was taken.
      if (participant !== room.localParticipant || !prev) return;
      const had = mayPublish(prev, Track.Source.Microphone);
      const has = mayPublish(participant.permissions, Track.Source.Microphone);
      if (had && !has) {
        const mic = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track;
        // Unpublished, not just muted: unmuting it later (push-to-talk too) would skip LiveKit's publish permission check.
        if (mic) void room.localParticipant.unpublishTrack(mic).catch(() => undefined);
        setToast({ text: "Um moderador silenciou você", tone: "info" });
      } else if (!had && has) setToast({ text: "Você pode falar de novo", tone: "info" });
    };
    room.on(RoomEvent.ParticipantPermissionsChanged, onPermissions).on(RoomEvent.Disconnected, setDisconnectReason);
    return () => {
      room.off(RoomEvent.ParticipantPermissionsChanged, onPermissions).off(RoomEvent.Disconnected, setDisconnectReason);
    };
  }, [room]);

  // Turn on the devices chosen in the lobby once (guarded against StrictMode's double effect).
  const devicesApplied = useRef(false);
  useEffect(() => {
    if (devicesApplied.current) return;
    devicesApplied.current = true;
    // Picked in the lobby before the room's permissions were known.
    if (initialDevices.mic && mayPublish(local.permissions, Track.Source.Microphone))
      local.setMicrophoneEnabled(true).catch((e) => setToast({ text: deviceError(e, "o microfone"), tone: "error" }));
    if (initialDevices.camera && mayPublish(local.permissions, Track.Source.Camera))
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
    if (!micOn && !canSpeak) return setToast({ text: "Sem permissão para falar", tone: "error" });
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

  async function copy(text: string, done: () => void) {
    try {
      await navigator.clipboard.writeText(text);
      done();
    } catch {
      setToast({ text: `Copie manualmente: ${text}`, tone: "info" });
    }
  }

  async function invite(run: InviteOption["run"]) {
    setInvitesOpen(false);
    setInviting(true);
    try {
      const text = await run();
      if (text) await copy(text, () => setToast({ text: "Copiado", tone: "info" }));
    } catch (e) {
      setToast({ text: (e as Error).message, tone: "error" });
    } finally {
      setInviting(false);
    }
  }

  const people = [local, ...remotePeople(room)];
  assignPersonColors(people.toSorted(byJoinOrder).map((p) => p.identity));
  const moreItems = [
    { label: "Reações", icon: SmilePlus, open: setReactionsOpen },
    { label: "Assistir junto", icon: Popcorn, open: setWatchOpen },
    ...(inDiscord ? [] : [{ label: "Soundboard", icon: Megaphone, open: setSoundsOpen }]),
    ...(plugins.sessions.length > 0 ? [{ label: "Plugins", icon: Blocks, open: setPluginsOpen }] : []),
  ];
  // From md the chat is a column (ChatPanel's md:w-[22rem] xl:w-[26rem] + the row's gap-3); keep the dock under the stage.
  const besideChat = chatOpen ? "md:mr-[calc(22rem+0.75rem)] xl:mr-[calc(26rem+0.75rem)]" : "";
  const focusMore = () => moreRef.current?.querySelector("button")?.focus();
  const hasRemoteScreenAudio = [...room.remoteParticipants.values()].some((p) =>
    [...p.audioTrackPublications.values()].some((pub) => pub.source === Track.Source.ScreenShareAudio),
  );

  return (
    <div className={`flex h-full flex-col bg-canvas ${discordPip ? "" : "gap-3 p-3 sm:gap-4 sm:p-4"}`}>
      <RoomAudio room={room} />

      <header className={`flex items-center gap-2.5 sm:gap-3.5 ${discordPip ? "hidden" : ""}`}>
        {shell ? (
          // In the site's frame the "H" opens the drawer; from lg the rail already shows it.
          <button
            type="button"
            onClick={shell.openNav}
            aria-label="Abrir navegação"
            title="Abrir navegação"
            className="shrink-0 rounded-md transition hover:-translate-y-px active:translate-y-px lg:hidden"
          >
            <LogoMark className="size-10 -rotate-3" />
          </button>
        ) : (
          <LogoMark className="size-10 -rotate-3 max-sm:hidden" />
        )}
        <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5 sm:flex-row sm:items-center sm:gap-3.5">
          <h1 className="max-w-full truncate font-display text-2xl leading-tight font-extrabold tracking-[-0.02em]">
            {info.name}
          </h1>
          <button
            onClick={() => copy(formatCode(info.code), () => setCopied("code"))}
            className={`${chipClass} pr-1 transition hover:bg-surface-hi`}
            title="Copiar código"
          >
            <span className="font-mono font-medium tracking-[0.04em]">{formatCode(info.code)}</span>
            <span className="ml-0.5 grid size-6 place-items-center rounded-full bg-surface-hi">
              {copied === "code" ? <Check className="size-3.5 text-accent-hi" /> : <Copy className="size-3.5" />}
            </span>
          </button>
        </div>
        {/* `relative` here, not per button: the popovers hang from the header's right edge and stay on screen on phones. */}
        <div className="relative flex shrink-0 items-center gap-2 sm:gap-3">
          <div ref={peopleRef} className="contents">
            <button
              onClick={() => setPeopleOpen(!peopleOpen)}
              aria-expanded={peopleOpen}
              title="Pessoas"
              className="group flex h-11 items-center gap-2 rounded-full border-2 border-line bg-surface px-3.5 font-display text-[17px] font-extrabold transition hover:bg-surface-hi sm:pl-2"
            >
              <span aria-hidden className="mr-0.5 hidden -space-x-1 sm:flex">
                {people.slice(0, 4).map((p) => (
                  <Avatar
                    key={p.identity}
                    name={nameOf(p)}
                    seed={p.identity}
                    image={discordAvatar(p)}
                    size="xs"
                    className="ring-2 ring-surface group-hover:ring-surface-hi"
                  />
                ))}
                {people.length > 4 && (
                  <span className="grid size-6 place-items-center rounded-full bg-surface-hi font-sans text-[10px] font-bold ring-2 ring-surface group-hover:ring-surface-hi">
                    +{people.length - 4}
                  </span>
                )}
              </span>
              <Users className="size-[18px] text-soft" /> {people.length}
              <span className="sr-only">{people.length === 1 ? " pessoa na sala" : " pessoas na sala"}</span>
            </button>
            {peopleOpen && (
              <PeoplePanel
                room={room}
                token={token}
                moderation={moderation}
                onError={(text) => setToast({ text, tone: "error" })}
              />
            )}
          </div>
          <div ref={invitesRef} className="contents">
            <Button
              variant="primary"
              className="h-11! px-[11px]! sm:px-4.5!"
              onClick={
                invites
                  ? () => setInvitesOpen(!invitesOpen)
                  : () => copy(`${location.origin}/r/${info.code}`, () => setCopied("link"))
              }
              disabled={inviting}
              aria-expanded={invites ? invitesOpen : undefined}
              aria-label={copied === "link" ? "Link copiado" : "Convidar"}
              title={copied === "link" ? "Link copiado" : "Convidar"}
            >
              {inviting ? (
                <Spinner className="size-[18px]" />
              ) : copied === "link" ? (
                <Check className="size-[18px]" />
              ) : (
                <UserPlus className="size-[18px]" />
              )}
              <span className="hidden sm:inline">{copied === "link" ? "Link copiado" : "Convidar"}</span>
            </Button>
            {invitesOpen && invites && (
              <div
                role="menu"
                aria-label="Convidar"
                className="absolute top-full right-0 z-40 mt-2 w-[min(18rem,calc(100vw-1.5rem))] animate-pop rounded-lg border-2 border-line bg-panel p-2 shadow-float"
              >
                {invites.map(({ label, icon: Icon, run }) => (
                  <button
                    key={label}
                    role="menuitem"
                    onClick={() => void invite(run)}
                    className="flex w-full items-center gap-2.5 rounded-full px-3 py-2 text-left text-sm font-semibold text-soft transition hover:bg-surface-hi hover:text-ink"
                  >
                    <Icon className="size-4 shrink-0" />
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      {state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting ? (
        <div className="type-link-sm flex items-center justify-center gap-2 rounded-full border-2 border-[color-mix(in_srgb,var(--color-warn)_30%,var(--color-line))] bg-surface py-2 text-warn">
          <Spinner className="size-4" /> Reconectando…
        </div>
      ) : null}

      {!room.canPlaybackAudio && (
        <button
          onClick={() => void room.startAudio()}
          className="type-link-sm flex items-center justify-center gap-2 rounded-full border-2 border-accent-hi bg-accent py-2 text-on-accent shadow-sticker transition hover:-translate-y-px hover:bg-accent-hi active:translate-y-px active:shadow-none"
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
        className={`relative flex items-center justify-center-safe gap-2 md:gap-2.5 ${besideChat} ${discordPip ? "hidden" : ""}`}
      >
        {/* In the Activity the voice is the Discord channel's. */}
        {!inDiscord && (
          <div className="relative">
            <ControlButton on={micOn} busy={busy === "mic"} disabled={!canSpeak} onClick={toggleMic} label={!canSpeak ? "Sem permissão para falar" : micOn ? "Desligar microfone" : ptt?.enabled && ptt.binding ? `Ligar microfone (ou segure ${ptt.binding})` : "Ligar microfone"}>
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
            tone="neutral"
            on={cameraOn}
            busy={busy === "camera"}
            disabled={!canVideo}
            onClick={toggleCamera}
            label={!canVideo ? "Sem permissão de vídeo" : cameraOn ? "Desligar câmera" : cameraBlocked ? "Ligar câmera pelo navegador" : "Ligar câmera"}
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
        <span aria-hidden className="mx-1.5 h-7 w-px shrink-0 bg-line max-sm:hidden" />
        {/* `contents`, not `relative`: the panel anchors to the footer so it stays centred on narrow screens. */}
        <div ref={screensRef} className="contents">
          <ControlButton
            tone="plain"
            on={sendingCount > 0}
            expanded={screensOpen}
            disabled={!canScreen}
            onClick={() => setScreensOpen(!screensOpen)}
            label={canScreen ? "Transmissões de tela" : "Sem permissão de vídeo"}
          >
            <MonitorUp className="size-5" />
            {sendingCount > 0 && (
              <span className={`${countClass} absolute -top-1.5 -right-1.5`}>
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
            className="max-sm:hidden"
          >
            <SmilePlus className="size-5" />
          </ControlButton>
          {reactionsOpen && reactionTargetTile && (
            <div className="absolute bottom-full left-1/2 z-40 mb-3 max-w-[calc(100vw-1.5rem)] -translate-x-1/2 animate-pop rounded-lg border-2 border-line bg-panel p-2 shadow-float">
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
            className="max-sm:hidden"
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
              className="max-sm:hidden"
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
              className="max-sm:hidden"
            >
              <Blocks className="size-5" />
            </ControlButton>
            {pluginsOpen && <PluginPanel plugins={plugins} onOpen={openPlugin} onClose={closePlugin} />}
          </div>
        )}
        <span aria-hidden className="mx-1.5 h-7 w-px shrink-0 bg-line max-sm:hidden" />
        <ControlButton
          tone="plain"
          on={chatOpen}
          expanded={chatOpen}
          onClick={() => setChatOpen(!chatOpen)}
          label={chatOpen ? "Fechar chat" : "Abrir chat"}
        >
          <MessageSquare className="size-5" />
          {!chatOpen && chatState.unread > 0 && (
            <span className={`${countClass} absolute -top-1.5 -right-1.5`}>
              {chatState.unread > 9 ? "9+" : chatState.unread}
            </span>
          )}
        </ControlButton>
        <div ref={moreRef} className="contents sm:hidden">
          <ControlButton
            tone="plain"
            on={moreOpen || reactionsOpen || watchOpen || !!watch.party || soundsOpen || pluginsOpen || plugins.sessions.some((s) => s.open)}
            expanded={moreOpen}
            onClick={() => setMoreOpen(!moreOpen)}
            label="Mais opções"
          >
            <Ellipsis className="size-5" />
          </ControlButton>
          {moreOpen && (
            <div
              role="menu"
              aria-label="Mais opções"
              onKeyDown={(e) => e.key === "Escape" && focusMore()}
              className="absolute bottom-full left-1/2 z-40 mb-3 grid w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 animate-pop auto-cols-fr grid-flow-col rounded-lg border-2 border-line bg-panel px-0.5 pt-3.5 pb-3 shadow-float"
            >
              {moreItems.map(({ label, icon: Icon, open }) => (
                <button
                  key={label}
                  role="menuitem"
                  onClick={() => {
                    setMoreOpen(false);
                    open(true);
                    focusMore(); // the item unmounts; WatchPanel's autoFocus still wins after the commit
                  }}
                  className="group flex flex-col items-center gap-2 text-xs font-bold text-ink"
                >
                  <span className="grid size-11.5 place-items-center rounded-full border-2 border-line bg-surface transition group-hover:-translate-y-px group-hover:bg-surface-hi group-active:translate-y-px">
                    <Icon className="size-5" />
                  </span>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={() => {
            playCue("leave");
            onLeave();
          }}
          className="flex h-12 w-12 shrink-0 items-center justify-center gap-2 rounded-full border-2 border-[color-mix(in_srgb,var(--color-danger)_55%,white)] bg-danger font-display text-[17px] font-extrabold text-on-accent shadow-sticker transition duration-200 ease-out-expo hover:-translate-y-px hover:bg-[color-mix(in_srgb,var(--color-danger)_85%,white)] active:translate-y-px active:shadow-none sm:w-auto sm:pr-5.5 sm:pl-4.5 md:h-14"
          aria-label="Sair da sala"
        >
          <PhoneOff className="size-5" />
          <span className="hidden sm:inline">Sair</span>
        </button>
        {canSpeak && ptt?.enabled && ptt.binding && (
          <span className="ml-1.5 hidden items-center gap-1.5 text-[13px] font-semibold whitespace-nowrap text-soft lg:inline-flex">
            Segure <kbd className={kbdClass}>{ptt.binding}</kbd> para falar
          </span>
        )}
      </footer>

      {hasRemoteScreenAudio && tiles.length > 0 && !discordPip && (
        <p className={`-mt-1 hidden text-center text-xs text-soft sm:block ${besideChat}`}>
          Passe o mouse numa tela ou pessoa para ajustar o volume — só muda pra você.
        </p>
      )}

      {toast && (
        <div
          role="status"
          className={`fixed ${discordPip ? "bottom-2" : "bottom-28"} left-1/2 z-50 w-[min(92vw,30rem)] -translate-x-1/2 animate-fade-in rounded-lg border-2 px-4 py-3 text-sm font-semibold shadow-float ${toast.tone === "error" ? "border-[color-mix(in_srgb,var(--color-danger)_55%,white)] bg-danger text-on-accent" : "border-line bg-surface text-ink"
            }`}
          onClick={() => setToast(null)}
        >
          {toast.text}
        </div>
      )}

      {state === ConnectionState.Disconnected && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-scrim p-4 backdrop-blur-sm">
          <div className={`${cardClass} flex w-full max-w-sm animate-pop flex-col items-center gap-5 p-8 text-center sm:p-10`}>
            <div className="grid size-14 place-items-center rounded-md border-2 border-[color-mix(in_srgb,var(--color-danger)_40%,var(--color-surface))] bg-[color-mix(in_srgb,var(--color-danger)_14%,var(--color-surface))] text-danger">
              <WifiOff className="size-7" />
            </div>
            <div>
              <h2 className="type-heading-sm">Você saiu da sala</h2>
              <p className="mt-1.5 text-soft">
                {disconnectReason === DisconnectReason.PARTICIPANT_REMOVED
                  ? "Um moderador desconectou você."
                  : "A conexão caiu ou foi encerrada."}
              </p>
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
