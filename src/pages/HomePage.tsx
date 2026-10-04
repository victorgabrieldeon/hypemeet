import { ArrowRight, Clock, Download, Hash, Plus, Trash2, UserRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CallPreview } from "../components/CallPreview";
import { UpdateButton } from "../components/UpdateButton";
import {
  Avatar,
  Button,
  Field,
  Logo,
  LogoMark,
  Spinner,
  Wordmark,
  glowCardClass,
  headerLinkClass,
  inputClass,
} from "../components/ui";
import { api, type PresentPerson } from "../lib/api";
import { formatCode, normalizeCode } from "../lib/code";
import { IS_DESKTOP_APP } from "../lib/downloads";
import { usePresence } from "../lib/presence";
import { forgetRoom, loadNickname, rememberRoom, saveNickname, useSavedRooms } from "../lib/storage";

const relativeTime = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });

function timeAgo(ts: number): string {
  const minutes = Math.round((ts - Date.now()) / 60_000);
  if (Math.abs(minutes) < 60) return relativeTime.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relativeTime.format(hours, "hour");
  return relativeTime.format(Math.round(hours / 24), "day");
}

const PRESENCE_AVATARS = 3;

/** "3 pessoas agora" with the first faces stacked; names on hover. */
function RoomPresence({ people }: { people: PresentPerson[] }) {
  const extra = people.length - PRESENCE_AVATARS;
  const ring = "ring-2 ring-panel transition group-hover:ring-surface";
  return (
    <div className="mt-1.5 flex items-center gap-2 text-sm" title={people.map((p) => p.name).join(", ")}>
      <div className="flex -space-x-1.5" aria-hidden>
        {people.slice(0, PRESENCE_AVATARS).map((p) => (
          <Avatar key={p.identity} name={p.name} size="xs" className={ring} />
        ))}
        {extra > 0 && (
          <span className={`grid size-6 place-items-center rounded-full bg-surface-hi text-[0.625rem] font-bold ${ring}`}>
            +{extra}
          </span>
        )}
      </div>
      <span className="font-semibold text-blurple-hi">
        {people.length} {people.length === 1 ? "pessoa" : "pessoas"} agora
      </span>
    </div>
  );
}

type Mode = "create" | "join";

export function HomePage() {
  const navigate = useNavigate();
  const savedRooms = useSavedRooms();
  const presence = usePresence(savedRooms.map((r) => r.code));
  const [nickname, setNickname] = useState(loadNickname);
  const [mode, setMode] = useState<Mode>("create");
  const [roomName, setRoomName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const persistNickname = () => saveNickname(nickname.trim());

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const clean = normalizeCode(code);
    if (mode === "create" && !roomName.trim()) return setError("Dê um nome para a sala");
    if (mode === "join" && clean.length !== 6) return setError("O código tem 6 caracteres");
    setBusy(true);
    setError(null);
    persistNickname();
    try {
      if (mode === "create") {
        const room = await api.createRoom(roomName);
        rememberRoom(room);
        navigate(`/r/${room.code}`);
      } else {
        const room = await api.getRoom(clean);
        navigate(`/r/${room.code}`);
      }
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const modeSwitch = (
    <div className="flex rounded-full bg-surface-hi p-0.5" role="group" aria-label="Criar ou entrar">
      {(["create", "join"] as const).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          onClick={() => {
            setMode(m);
            setError(null);
          }}
          className={`rounded-full px-3 py-1 text-xs font-semibold transition ${mode === m ? "bg-blurple text-ink" : "text-soft hover:text-ink"
            }`}
        >
          {m === "create" ? "Criar" : "Entrar"}
        </button>
      ))}
    </div>
  );

  return (
    <div className="aurora min-h-full">
      <header className="mx-auto flex max-w-[1240px] items-center justify-between px-5 py-5 sm:px-8 sm:py-7">
        <Logo />
        {IS_DESKTOP_APP ? (
          <UpdateButton />
        ) : (
          <Link to="/baixar" className={headerLinkClass} aria-label="Baixar app" title="Baixar app">
            <Download className="size-4" />
            <span className="hidden sm:inline">Baixar app</span>
          </Link>
        )}
      </header>

      <main className="mx-auto grid max-w-[1240px] items-center gap-8 px-5 pt-4 pb-16 sm:px-8 lg:min-h-[calc(100svh-7.5rem)] lg:grid-cols-[1.1fr_1fr] lg:gap-16 lg:pb-24">
        {/* Returning visitors see their rooms first; newcomers get the call preview instead. */}
        {savedRooms.length > 0 ? (
          <section aria-labelledby="salas-titulo" className="flex min-w-0 animate-fade-in flex-col gap-4">
            <h2 id="salas-titulo" className="flex items-baseline gap-3 font-display text-xl font-bold">
              Suas salas
              <span className="text-sm font-medium text-soft">{savedRooms.length}</span>
            </h2>
            <ul className="-mr-2 flex max-h-[42svh] flex-col gap-3 overflow-y-auto pr-2 [scrollbar-width:thin] lg:max-h-[min(36rem,calc(100svh-14rem))]">
              {savedRooms.map((room) => (
                <li
                  key={room.code}
                  className="group flex items-center gap-4 rounded-lg border border-line bg-panel p-3 transition hover:border-white/[0.12] hover:bg-surface"
                >
                  <Avatar name={room.name} shape="square" />
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-display font-bold">{room.name}</h3>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-sm text-soft">
                      <span className="font-mono tracking-widest">{formatCode(room.code)}</span>
                      <span className="flex items-center gap-1">
                        <Clock className="size-3.5" /> {timeAgo(room.lastJoinedAt)}
                      </span>
                    </p>
                    {presence[room.code] && <RoomPresence people={presence[room.code]} />}
                  </div>
                  <button
                    onClick={() => forgetRoom(room.code)}
                    className="grid size-10 shrink-0 place-items-center rounded-md text-soft opacity-0 transition group-hover:opacity-100 hover:bg-surface-hi hover:text-danger focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
                    aria-label={`Remover ${room.name}`}
                    title="Remover da lista"
                  >
                    <Trash2 className="size-4" />
                  </button>
                  <Button
                    variant="primary"
                    className="type-link-sm h-10"
                    onClick={() => {
                      persistNickname();
                      navigate(`/r/${room.code}`);
                    }}
                    aria-label={`Entrar em ${room.name}`}
                  >
                    <span className="hidden sm:inline">Entrar</span> <ArrowRight className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <div className="hidden lg:block">
            <CallPreview />
          </div>
        )}

        <section className={`${glowCardClass} mx-auto w-full max-w-[34rem] animate-pop p-5 sm:p-10`}>
          <div className="mb-8 flex flex-col items-center gap-4 text-center">
            <LogoMark className="size-14" />
            <h1>
              <Wordmark className="text-[2.5rem] leading-none sm:text-[2.75rem]" />
            </h1>
            <p className="max-w-[36ch] text-soft">
              Crie uma sala, mande o código pra galera e compartilhe quantas telas quiser — com som.
            </p>
          </div>

          <div className="flex flex-col gap-4">
            <Field label="Seu apelido" htmlFor="nickname" icon={UserRound}>
              <input
                id="nickname"
                className={inputClass}
                placeholder="Como a galera vai te ver"
                value={nickname}
                maxLength={32}
                onChange={(e) => setNickname(e.target.value)}
                onBlur={persistNickname}
              />
            </Field>

            <form onSubmit={onSubmit} className="flex flex-col gap-2">
              <Field
                label={mode === "create" ? "Nome da nova sala" : "Código da sala"}
                htmlFor="room"
                icon={mode === "create" ? Plus : Hash}
                header={modeSwitch}
                trailing={
                  <Button
                    type="submit"
                    variant="primary"
                    square
                    disabled={busy}
                    aria-label={mode === "create" ? "Criar sala" : "Entrar na sala"}
                  >
                    {busy ? <Spinner className="size-5" /> : <ArrowRight className="size-5" strokeWidth={2.25} />}
                  </Button>
                }
              >
                {mode === "create" ? (
                  <input
                    id="room"
                    key="create"
                    className={inputClass}
                    placeholder="Ex.: Ranked de sexta"
                    value={roomName}
                    maxLength={60}
                    onChange={(e) => setRoomName(e.target.value)}
                  />
                ) : (
                  <input
                    id="room"
                    key="join"
                    autoFocus
                    className={`${inputClass} font-mono tracking-[0.2em] uppercase`}
                    placeholder="ABC-123"
                    value={code}
                    maxLength={9}
                    onChange={(e) => setCode(e.target.value)}
                  />
                )}
              </Field>
              {error && (
                <p role="alert" className="px-1 text-sm text-danger">
                  {error}
                </p>
              )}
            </form>
          </div>
        </section>
      </main>
    </div>
  );
}
