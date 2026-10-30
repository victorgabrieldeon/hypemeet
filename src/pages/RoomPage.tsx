import { Room } from "livekit-client";
import { ArrowLeft, Mic, MicOff, UserRound, Video, VideoOff } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button, Field, Logo, Spinner, glowCardClass, inputClass } from "../components/ui";
import { api, type JoinGrant, type RoomInfo } from "../lib/api";
import { formatCode, normalizeCode } from "../lib/code";
import { loadNickname, rememberRoom, saveNickname } from "../lib/storage";
import { deviceRoomOptions } from "../room/devices";
import { RoomChat } from "../room/chat";
import { ScreenPreviews } from "../room/previews";
import { RoomView } from "../room/RoomView";
import { VolumeProvider } from "../room/volume";
import { playCue } from "../room/sounds";

type Phase =
  | { step: "loading" }
  | { step: "missing"; message: string }
  | { step: "lobby"; info: RoomInfo }
  | { step: "live"; info: RoomInfo; grant: JoinGrant; devices: { mic: boolean; camera: boolean } };

function CenteredCard({ children }: { children: ReactNode }) {
  return (
    <div className="aurora grid min-h-full place-items-center px-4 py-10">
      <div className={`${glowCardClass} flex w-full max-w-md animate-pop flex-col gap-7 p-6 sm:p-10`}>
        {children}
      </div>
    </div>
  );
}

export function RoomPage() {
  const { code: rawCode = "" } = useParams();
  const code = normalizeCode(rawCode);
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>({ step: "loading" });

  useEffect(() => {
    let cancelled = false;
    api
      .getRoom(code)
      .then((info) => {
        if (cancelled) return;
        document.title = `${info.name} · HypeMeet`;
        setPhase({ step: "lobby", info });
      })
      .catch((err: Error) => !cancelled && setPhase({ step: "missing", message: err.message }));
    return () => {
      cancelled = true;
      document.title = "HypeMeet";
    };
  }, [code]);

  if (phase.step === "loading") {
    return (
      <div className="grid h-full place-items-center text-soft">
        <Spinner className="size-7" />
      </div>
    );
  }

  if (phase.step === "missing") {
    return (
      <CenteredCard>
        <Logo />
        <div>
          <h1 className="type-heading-sm text-2xl">{phase.message}</h1>
          <p className="mt-2 text-soft">
            Confira o código <span className="font-mono text-ink">{formatCode(code)}</span> com quem te convidou.
          </p>
        </div>
        <Button variant="primary" onClick={() => navigate("/")}>
          Voltar ao início
        </Button>
      </CenteredCard>
    );
  }

  if (phase.step === "lobby") {
    return (
      <Lobby
        info={phase.info}
        onJoined={(grant, devices) => {
          rememberRoom(grant.room);
          setPhase({ step: "live", info: grant.room, grant, devices });
        }}
      />
    );
  }

  return (
    <LiveRoom
      key={phase.grant.token}
      info={phase.info}
      grant={phase.grant}
      devices={phase.devices}
      onLeave={() => navigate("/")}
      onRejoin={() => setPhase({ step: "lobby", info: phase.info })}
    />
  );
}

function Lobby({
  info,
  onJoined,
}: {
  info: RoomInfo;
  onJoined: (grant: JoinGrant, devices: { mic: boolean; camera: boolean }) => void;
}) {
  const [nickname, setNickname] = useState(loadNickname);
  const [mic, setMic] = useState(false);
  const [camera, setCamera] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const name = nickname.trim();
    if (!name) return setError("Escolha um apelido");
    saveNickname(name);
    setJoining(true);
    setError(null);
    try {
      onJoined(await api.joinRoom(info.code, name), { mic, camera });
    } catch (err) {
      setError((err as Error).message);
      setJoining(false);
    }
  }

  const toggleClass = (on: boolean) =>
    `type-link-sm flex h-12 flex-1 items-center justify-center gap-2 rounded-md border transition ${on
      ? "border-blurple/60 bg-blurple/15 text-ink hover:bg-blurple/25"
      : "border-line bg-surface text-soft hover:bg-surface-hi hover:text-ink"
    }`;

  return (
    <CenteredCard>
      <div className="flex items-center justify-between">
        <Link to="/" className="type-link-sm flex items-center gap-1.5 text-soft transition hover:text-ink">
          <ArrowLeft className="size-4" /> Início
        </Link>
        <span className="rounded-md border border-line bg-surface px-3 py-1.5 font-mono text-sm tracking-widest text-soft">
          {formatCode(info.code)}
        </span>
      </div>
      <h1 className="font-display text-[clamp(1.75rem,1.3rem+2vw,2.25rem)] leading-tight font-bold tracking-[-0.02em] break-words">
        {info.name}
      </h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <Field label="Seu apelido" htmlFor="lobby-nickname" icon={UserRound}>
          <input
            id="lobby-nickname"
            autoFocus={!nickname}
            className={inputClass}
            value={nickname}
            maxLength={32}
            placeholder="Como a galera vai te ver"
            onChange={(e) => setNickname(e.target.value)}
          />
        </Field>
        <div className="flex gap-2">
          <button type="button" className={toggleClass(mic)} onClick={() => setMic(!mic)} aria-pressed={mic}>
            {mic ? <Mic className="size-4" /> : <MicOff className="size-4" />} Microfone
          </button>
          <button type="button" className={toggleClass(camera)} onClick={() => setCamera(!camera)} aria-pressed={camera}>
            {camera ? <Video className="size-4" /> : <VideoOff className="size-4" />} Câmera
          </button>
        </div>
        {error && (
          <p role="alert" className="px-1 text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" className="mt-2" disabled={joining}>
          {joining && <Spinner className="size-5" />} Entrar na sala
        </Button>
      </form>
    </CenteredCard>
  );
}

export function LiveRoom({
  info,
  grant,
  devices,
  onLeave,
  onRejoin,
  connectErrorExtra,
  inviteUrl,
  onInvite,
  onCast,
  youTubeStream,
  discordPip,
}: {
  info: RoomInfo;
  grant: JoinGrant;
  devices: { mic: boolean; camera: boolean };
  onLeave: () => void;
  onRejoin: () => void;
  /** Shown under the error when the room can't connect. */
  connectErrorExtra?: ReactNode;
  inviteUrl?: string;
  onInvite?: () => void;
  onCast?: (withCamera: boolean) => Promise<void>;
  youTubeStream?: (videoId: string) => string;
  /** Discord has the Activity in its picture-in-picture (see RoomView). */
  discordPip?: boolean;
}) {
  const [session, setSession] = useState<{ room: Room; chat: RoomChat; previews: ScreenPreviews } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const instance = new Room({
      adaptiveStream: true, // subscribers only receive the resolution their tile actually needs
      dynacast: true, // publishers pause layers nobody watches
      webAudioMix: true, // routes audio through a GainNode so per-listener volume can go above 100%
      ...deviceRoomOptions(), // start on the mic/camera/speaker picked last time
    });
    const chat = new RoomChat(instance);
    const previews = new ScreenPreviews(instance);
    let cancelled = false;
    instance
      // Screens are opt-in: useSubscriptions picks what to receive.
      .connect(grant.url ?? location.origin.replace(/^http/, "ws"), grant.token, { autoSubscribe: false })
      .then(() => {
        if (cancelled) return;
        setSession({ room: instance, chat, previews });
        playCue("join");
      })
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
      void instance.disconnect();
      chat.dispose();
      previews.dispose();
    };
  }, [grant]);

  if (error) {
    return (
      <CenteredCard>
        <div>
          <h1 className="type-heading-sm text-2xl">Não foi possível conectar</h1>
          <p className="mt-2 break-words text-soft">{error}</p>
        </div>
        {connectErrorExtra}
        <div className="flex gap-2">
          <Button className="flex-1" onClick={onLeave}>
            Início
          </Button>
          <Button className="flex-1" variant="primary" onClick={onRejoin}>
            Tentar de novo
          </Button>
        </div>
      </CenteredCard>
    );
  }

  if (!session) {
    return (
      <div className="grid h-full place-items-center">
        <div className="flex flex-col items-center gap-4 text-soft">
          <Spinner className="size-7" /> Conectando em {info.name}…
        </div>
      </div>
    );
  }

  return (
    <VolumeProvider>
      <RoomView room={session.room} token={grant.token} chat={session.chat} previews={session.previews} info={info} initialDevices={devices} onLeave={onLeave} onRejoin={onRejoin} inviteUrl={inviteUrl} onInvite={onInvite} onCast={onCast} youTubeStream={youTubeStream} discordPip={discordPip} />
    </VolumeProvider>
  );
}
