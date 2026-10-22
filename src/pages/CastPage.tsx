import { DisconnectReason, Room, RoomEvent } from "livekit-client";
import { ArrowRight, Video, VideoOff } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button, inputClass, Logo, Spinner, glowCardClass } from "../components/ui";
import { api } from "../lib/api";
import { obeyOwner } from "../room/cast";
import { deviceRoomOptions, loadScreenPrefs, saveScreenPrefs } from "../room/devices";
import { buildTiles, SCREEN_AUDIO_COPY, startScreenShare, useRoomVersion, useScreenAudioCleanup, type TileModel } from "../room/model";
import { ScreenPreviews } from "../room/previews";
import { ScreenPanel } from "../room/ScreenPanel";
import { parseYouTube } from "../room/youtube";

// The browser transmitter opened from the Discord Activity (see room/cast.ts): it joins the room only
// to send screens and a camera, which everyone sees as its owner's.

/** How long the owner may be gone (a reconnect, a reloaded Activity) before the transmission stops. */
const OWNER_GRACE_MS = 20_000;

interface CastLink {
  token: string;
  /** LiveKit URL; null → this origin (dev proxy). */
  url: string | null;
  owner: string;
  name: string;
  code: string;
  /** Opened from the Activity's camera button: turn it on right away. */
  camera: boolean;
}

/** The link carries the grant in its fragment: `#t=<room token>&u=<livekit url>`, plus `&cam=1` for the camera. */
function readLink(): CastLink | null {
  const params = new URLSearchParams(location.hash.slice(1));
  const token = params.get("t");
  const payload = token?.split(".")[1];
  if (!token || !payload) return null;
  try {
    const bytes = Uint8Array.from(atob(payload.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    const claims = JSON.parse(new TextDecoder().decode(bytes)) as {
      name?: string;
      video?: { room?: string };
      attributes?: { castFor?: string };
    };
    const owner = claims.attributes?.castFor;
    const code = claims.video?.room;
    if (!owner || !code) return null;
    return { token, url: params.get("u"), owner, name: claims.name ?? "", code, camera: params.has("cam") };
  } catch {
    return null;
  }
}

function Card({ children }: { children: ReactNode }) {
  return (
    <div className="aurora grid min-h-full place-items-center px-4 py-10">
      <div className={`${glowCardClass} flex w-full max-w-md animate-pop flex-col gap-6 p-6 sm:p-8`}>{children}</div>
    </div>
  );
}

function Notice({ title, text }: { title: string; text: string }) {
  return (
    <Card>
      <Logo />
      <div>
        <h1 className="type-heading-sm text-2xl">{title}</h1>
        <p className="mt-2 break-words text-soft">{text}</p>
      </div>
    </Card>
  );
}

export function CastPage() {
  const [link] = useState(readLink);
  const [room, setRoom] = useState<Room | null>(null);
  const [roomName, setRoomName] = useState<string | null>(null);
  const [ended, setEnded] = useState<{ title: string; text: string } | null>(null);

  useEffect(() => {
    document.title = "Transmitir · HypeMeet";
    if (link) api.getRoom(link.code).then((r) => setRoomName(r.name), () => undefined);
  }, [link]);

  useEffect(() => {
    if (!link) return;
    // The camera picked last time on this browser.
    const instance = new Room({ dynacast: true, ...deviceRoomOptions() });
    const previews = new ScreenPreviews(instance);
    const stopObeying = obeyOwner(instance, link.owner);
    let cancelled = false;
    let ownerGone: ReturnType<typeof setTimeout> | undefined;

    const checkOwner = () => {
      clearTimeout(ownerGone);
      if (instance.remoteParticipants.has(link.owner)) return;
      ownerGone = setTimeout(() => {
        setEnded({ title: "Transmissão encerrada", text: "Você saiu da sala no Discord, então a transmissão parou." });
        void instance.disconnect();
      }, OWNER_GRACE_MS);
    };
    instance
      .on(RoomEvent.ParticipantConnected, checkOwner)
      .on(RoomEvent.ParticipantDisconnected, checkOwner)
      .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        if (cancelled || reason === DisconnectReason.CLIENT_INITIATED) return;
        setEnded({ title: "A conexão caiu", text: "Abra a atividade no Discord e transmita de novo." });
      });

    instance
      .connect(link.url ?? location.origin.replace(/^http/, "ws"), link.token, { autoSubscribe: false })
      .then(() => {
        if (cancelled) return;
        checkOwner();
        setRoom(instance);
      })
      .catch(
        () =>
          !cancelled &&
          setEnded({
            title: "Esse link não vale mais",
            text: "Ele expira em 15 minutos. Peça um novo pelo botão de tela ou de câmera da atividade no Discord.",
          }),
      );
    return () => {
      cancelled = true;
      clearTimeout(ownerGone);
      stopObeying();
      previews.dispose();
      void instance.disconnect();
    };
  }, [link]);

  if (!link) return <Notice title="Link inválido" text="Abra este link pelo botão de transmitir da atividade no Discord." />;
  if (ended) return <Notice {...ended} />;
  if (!room) {
    return (
      <div className="grid h-full place-items-center">
        <div className="flex flex-col items-center gap-4 text-soft">
          <Spinner className="size-7" /> Conectando…
        </div>
      </div>
    );
  }
  return <Transmitter room={room} name={link.name} roomName={roomName} startCamera={link.camera} />;
}

function Transmitter({
  room,
  name,
  roomName,
  startCamera,
}: {
  room: Room;
  name: string;
  roomName: string | null;
  startCamera: boolean;
}) {
  useRoomVersion(room);
  useScreenAudioCleanup(room);
  const local = room.localParticipant;
  const [prefs, setPrefs] = useState(loadScreenPrefs);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const screens = buildTiles(room).filter(
    (t): t is Extract<TileModel, { kind: "screen" }> => t.kind === "screen" && t.participant === local,
  );
  const cameraOn = local.isCameraEnabled;
  const [cameraBusy, setCameraBusy] = useState(false);
  const live = screens.length > 0 || cameraOn;
  // YouTube can't play in the Activity, so it plays here and this tab is sent, cropped to the player.
  const player = useRef<HTMLDivElement>(null);
  const [videoLink, setVideoLink] = useState("");
  const [video, setVideo] = useState<{ videoId: string; start: number } | null>(null);
  /** Track name of the player's capture, once it's on air. */
  const [playerScreen, setPlayerScreen] = useState<string | null>(null);
  const playerLive = screens.some((s) => s.video.trackName === playerScreen);

  // Stopped (here, from Discord or by the browser's bar): the video goes with it.
  useEffect(() => {
    if (playerScreen && !playerLive) {
      setPlayerScreen(null);
      setVideo(null);
    }
  }, [playerScreen, playerLive]);

  async function setCamera(on: boolean) {
    setCameraBusy(true);
    setMessage(null);
    try {
      await local.setCameraEnabled(on);
    } catch (e) {
      setMessage(
        (e as DOMException)?.name === "NotAllowedError"
          ? "Permissão negada para a câmera. Libere no cadeado da barra de endereço."
          : `Não deu pra ligar a câmera: ${(e as Error).message}`,
      );
    } finally {
      setCameraBusy(false);
    }
  }

  // Opened from the camera button: that's what you came for (once, despite StrictMode's double effect).
  const cameraStarted = useRef(false);
  useEffect(() => {
    if (!startCamera || cameraStarted.current) return;
    cameraStarted.current = true;
    void setCamera(true);
  });

  // Closing the tab ends the transmission: ask first.
  useEffect(() => {
    if (!live) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [live]);

  /** Opens the picker (for this tab, with `region`); resolves to the new screen's track name, or null. */
  async function start(region?: Element): Promise<string | null> {
    setStarting(true);
    setMessage(null);
    try {
      const { name, audio } = await startScreenShare(local, region ? { mode: "motion", audio: true } : prefs, region);
      if (region && !audio)
        setMessage("O vídeo foi sem som. Pare e transmita de novo deixando ligado o áudio da aba no seletor.");
      else if (prefs.audio && !audio) setMessage(SCREEN_AUDIO_COPY.missing);
      return name;
    } catch (e) {
      const errorName = (e as DOMException)?.name;
      // User closed the picker: not an error.
      if (errorName !== "NotAllowedError" && errorName !== "AbortError")
        setMessage(`Não deu pra compartilhar a tela: ${(e as Error).message}`);
      return null;
    } finally {
      setStarting(false);
    }
  }

  async function playVideo(e: FormEvent) {
    e.preventDefault();
    const parsed = parseYouTube(videoLink);
    if (!parsed) return setMessage("Isso não parece um link de vídeo do YouTube.");
    setVideo(parsed);
    // Already on air: the crop just shows the new video.
    if (playerLive) return;
    const name = await start(player.current!);
    if (name) setPlayerScreen(name);
    else setVideo(null);
  }

  return (
    <div
      className={`aurora flex min-h-full flex-col items-center justify-center gap-6 px-4 py-10 ${video ? "lg:flex-row lg:items-start" : ""}`}
    >
      {/* Always mounted: the crop target has to exist when the picker opens. Square: the crop is a rectangle.
          Sticky and on top: the crop sends whatever covers it, and nothing if it scrolls away. */}
      <div
        ref={player}
        className={video ? "sticky top-0 z-10 aspect-video w-full max-w-7xl bg-black lg:top-10 lg:flex-1" : "hidden"}
      >
        {video && playerScreen ? (
          <iframe
            key={`${video.videoId}:${video.start}`}
            src={`https://www.youtube.com/embed/${video.videoId}?autoplay=1&start=${video.start}&fs=0&rel=0&playsinline=1`}
            title="Vídeo do YouTube"
            allow="autoplay; encrypted-media"
            // YouTube refuses embeds without a Referer (error 153), whatever policy the page is served with.
            referrerPolicy="strict-origin-when-cross-origin"
            className="size-full"
          />
        ) : (
          <p className="grid size-full place-items-center px-4 text-center text-soft">
            No seletor, escolha esta aba e deixe o áudio dela ligado.
          </p>
        )}
      </div>
      <div className={`${glowCardClass} flex w-full max-w-md animate-pop flex-col gap-6 p-6 sm:p-8`}>
        <Logo />
        <div>
          <h1 className="type-heading-sm text-2xl">{live ? "Você está ao vivo" : "Escolha o que transmitir"}</h1>
          <p className="mt-2 text-soft">
            Transmitindo como <span className="font-semibold text-ink">{name}</span>
            {roomName && (
              <>
                {" "}
                em <span className="font-semibold text-ink">{roomName}</span>
              </>
            )}
            . Quem está na atividade do Discord vê tudo como seu.
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-md border border-line bg-surface p-3">
          <p className="min-w-0 flex-1 text-sm">
            <span className="block font-medium">Câmera</span>
            <span className="block text-xs text-soft">{cameraOn ? "No ar, no seu quadro da sala" : "Aparece no seu quadro da sala"}</span>
          </p>
          <button
            type="button"
            disabled={cameraBusy}
            onClick={() => void setCamera(!cameraOn)}
            className="type-link-sm flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-surface-hi px-3 text-ink transition hover:bg-blurple/25 disabled:opacity-60"
          >
            {cameraBusy ? <Spinner className="size-4" /> : cameraOn ? <VideoOff className="size-4" /> : <Video className="size-4" />}
            {cameraOn ? "Desligar" : "Ligar"}
          </button>
        </div>
        <form onSubmit={(e) => void playVideo(e)} className="flex flex-col gap-2 rounded-md border border-line bg-surface p-3">
          <span className="type-label px-0.5 pt-1 text-soft">Vídeo do YouTube</span>
          <div className="flex gap-2">
            <input
              className={inputClass}
              value={videoLink}
              onChange={(e) => setVideoLink(e.target.value)}
              placeholder="Cole o link (vídeo ou live)"
              aria-label="Link do YouTube"
            />
            <Button
              type="submit"
              variant="primary"
              square
              disabled={!videoLink.trim() || starting}
              aria-label={playerLive ? "Trocar vídeo" : "Transmitir vídeo"}
            >
              {starting && video ? <Spinner className="size-5" /> : <ArrowRight className="size-5" />}
            </Button>
          </div>
          <p className="px-0.5 text-xs text-soft">
            Toca nesta aba e vai pra sala como sua tela. Play, pausa e volume ficam no player (o volume muda pra todo
            mundo).
          </p>
        </form>
        <ScreenPanel
          inline
          screens={screens}
          prefs={prefs}
          onPrefsChange={(next) => {
            setPrefs(next);
            saveScreenPrefs(next);
          }}
          starting={starting}
          onStart={() => void start()}
          onError={setMessage}
        />
        {message && (
          <p role="status" className="text-sm text-soft">
            {message}
          </p>
        )}
        {live && <p className="text-sm text-soft">Pode minimizar esta aba, mas não feche: fechar para a transmissão.</p>}
      </div>
    </div>
  );
}
