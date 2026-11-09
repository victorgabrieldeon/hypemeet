import { ArrowRight, Download, Menu, Trash2, UserRound } from "lucide-react";
import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useShell, useWideNav } from "../components/AppShell";
import { UpdateButton } from "../components/UpdateButton";
import { Avatar, Button, Field, Logo, Spinner, cardClass, headerLinkClass, inputClass } from "../components/ui";
import { api, type PresentPerson } from "../lib/api";
import { useSession } from "../lib/auth";
import { formatCode, normalizeCode } from "../lib/code";
import { PERSON_COLORS } from "../lib/color";
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

/** --p for a fixed sticker colour (the person-* utilities and the classes below read it). */
const tint = (color: string) => ({ "--p": color }) as CSSProperties;
const [, , MINT, SUN] = PERSON_COLORS;

const PRESENCE_AVATARS = 3;

/** "3 pessoas agora" with the first faces stacked; names on hover. */
function RoomPresence({ people }: { people: PresentPerson[] }) {
  const extra = people.length - PRESENCE_AVATARS;
  return (
    <div className="flex items-center gap-2.5 text-sm font-bold text-ink" title={people.map((p) => p.name).join(", ")}>
      <div className="flex -space-x-1" aria-hidden>
        {people.slice(0, PRESENCE_AVATARS).map((p) => (
          <Avatar key={p.identity} name={p.name} seed={p.identity} size="xs" className="ring-2 ring-panel" />
        ))}
        {extra > 0 && (
          <span className="grid size-6 place-items-center rounded-full bg-surface-hi text-[0.625rem] font-bold ring-2 ring-panel">
            +{extra}
          </span>
        )}
      </div>
      <span
        aria-hidden
        style={tint(MINT)}
        className="size-2 shrink-0 rounded-full bg-(--p) shadow-[0_0_0_3px_color-mix(in_srgb,var(--p)_22%,transparent)]"
      />
      <span>
        {people.length} {people.length === 1 ? "pessoa" : "pessoas"} agora
      </span>
    </div>
  );
}

type Mode = "create" | "join";

export function HomePage() {
  const navigate = useNavigate();
  const openNav = useShell()?.openNav;
  const discordName = useSession()?.user?.name;
  const savedRooms = useSavedRooms();
  const wide = useWideNav();
  // From lg the list below is hidden and the sidebar shows (and polls) the same rooms.
  const presence = usePresence(wide ? [] : savedRooms.map((r) => r.code));
  const [nickname, setNickname] = useState(loadNickname);
  const [mode, setMode] = useState<Mode>("create");
  const [roomName, setRoomName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Signed in with Discord and no nickname of your own yet: start from the Discord name.
  useEffect(() => {
    if (discordName && !loadNickname()) setNickname((n) => n || discordName);
  }, [discordName]);

  const persistNickname = () => saveNickname(nickname.trim());
  const hasRooms = savedRooms.length > 0;

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
    <div className="grid grid-cols-2 rounded-full border-2 border-line bg-surface p-1" role="group" aria-label="Criar ou entrar">
      {(["create", "join"] as const).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          onClick={() => {
            setMode(m);
            setError(null);
          }}
          className={`type-link h-10.5 rounded-full transition ${mode === m
            ? "bg-accent text-on-accent shadow-[inset_0_0_0_2px_var(--color-accent-hi)]"
            : "text-soft hover:text-ink"
            }`}
        >
          {m === "create" ? "Criar" : "Entrar"}
        </button>
      ))}
    </div>
  );

  return (
    <div className="min-h-full overflow-x-clip">
      <header className="mx-auto flex max-w-[1440px] items-center justify-between px-5 py-5 sm:px-12 sm:pt-8 sm:pb-6">
        <div className="flex items-center gap-3">
          <button type="button" onClick={openNav} className={`${headerLinkClass} lg:hidden`} aria-label="Abrir menu" title="Abrir menu">
            <Menu className="size-4" />
          </button>
          <Logo />
        </div>
        {IS_DESKTOP_APP ? (
          <UpdateButton />
        ) : (
          <Link to="/baixar" className={headerLinkClass} aria-label="Baixar app" title="Baixar app">
            <Download className="size-4" />
            <span className="hidden sm:inline">Baixar app</span>
          </Link>
        )}
      </header>

      {/* The form, centred; below lg (no sidebar) returning visitors get their rooms under it. */}
      <main className="mx-auto grid max-w-[1440px] justify-items-center gap-10 px-5 pt-4 pb-16 sm:px-12 lg:min-h-[calc(100svh-6.5rem)] lg:content-center lg:py-4">
        <section
          className={`${cardClass} relative flex w-full animate-pop flex-col gap-5 p-6 sm:p-9 ${hasRooms ? "max-w-[520px] lg:max-w-[600px]" : "max-w-[600px]"}`}
        >
          {/* Decoration in the page margin. */}
          <svg
            aria-hidden
            viewBox="0 0 100 100"
            style={tint(SUN)}
            className="pointer-events-none absolute bottom-6 -left-21 hidden size-11.5 -rotate-12 fill-(--p) stroke-[color-mix(in_srgb,var(--p)_55%,white)] drop-shadow-[0_4px_5px_rgb(0_0_0/0.5)] xl:block"
          >
            <path
              d="M50 6l12.6 26.3 28.8 3.7-21.2 19.9 5.5 28.6L50 70.6 24.3 84.5l5.5-28.6L8.6 36l28.8-3.7z"
              strokeWidth={5}
              strokeLinejoin="round"
            />
          </svg>

          <h1
            className={`mb-1 font-display text-[26px] leading-[1.12] font-extrabold tracking-[-0.02em] text-balance ${hasRooms ? "sm:text-[31px] lg:text-[42px]" : "sm:text-[42px]"}`}
          >
            Crie uma sala, mande o código pra galera e compartilhe quantas telas quiser —{" "}
            <span className="relative z-0 whitespace-nowrap before:absolute before:-inset-x-1 before:bottom-[-5px] before:-z-10 before:h-[9px] before:rounded-[5px] before:bg-accent/85">
              com som.
            </span>
          </h1>

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

          {modeSwitch}

          <form onSubmit={onSubmit} className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Field label={mode === "create" ? "Nome da nova sala" : "Código da sala"} htmlFor="room">
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
                <p role="alert" className="px-1 text-sm font-medium text-danger">
                  {error}
                </p>
              )}
            </div>
            <Button
              type="submit"
              variant="primary"
              disabled={busy}
              aria-label={mode === "create" ? "Criar sala" : "Entrar na sala"}
              className="h-15! w-full pr-2 pl-6 font-display text-lg font-extrabold"
            >
              {mode === "create" ? "Criar sala" : "Entrar na sala"}
              <span className="ml-auto grid size-10.5 place-items-center rounded-full bg-on-accent text-accent-hi">
                {busy ? <Spinner className="size-5" /> : <ArrowRight className="size-5.5" strokeWidth={2.6} />}
              </span>
            </Button>
          </form>
        </section>

        {hasRooms && (
          <section aria-labelledby="salas-titulo" className="flex w-full max-w-[520px] min-w-0 animate-fade-in flex-col gap-5 lg:hidden">
            <h2
              id="salas-titulo"
              className="mt-0.5 ml-1 flex items-center gap-3 font-display text-[26px] leading-none font-extrabold tracking-[-0.02em] sm:text-[30px]"
            >
              Seus grupos
              <span className="grid h-7 min-w-7 place-items-center rounded-full bg-surface-hi px-2 font-sans text-sm font-extrabold tracking-normal text-ink">
                {savedRooms.length}
              </span>
            </h2>
            <ul className="flex flex-col gap-4">
              {savedRooms.map((room) => (
                <li
                  key={room.code}
                  className="flex gap-4 rounded-lg border-2 border-line bg-panel py-4.5 pr-4.5 pl-5 shadow-float"
                >
                  <Avatar name={room.name} seed={room.code} shape="square" className="size-14 text-lg" />
                  <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="mt-0.5 min-w-0 font-display text-xl leading-tight font-extrabold tracking-[-0.01em] break-words">
                        {room.name}
                      </h3>
                      <button
                        onClick={() => forgetRoom(room.code)}
                        className="-mt-1 -mr-1 grid size-10 shrink-0 place-items-center rounded-full text-soft transition hover:-translate-y-px hover:bg-surface hover:text-ink active:translate-y-px"
                        aria-label={`Remover ${room.name}`}
                        title="Remover da lista"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                    <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm font-medium text-soft">
                      <span className="rounded-xs bg-surface px-2 py-1 font-mono text-[13px] leading-none tracking-[0.04em] text-ink">
                        {formatCode(room.code)}
                      </span>
                      {timeAgo(room.lastJoinedAt)}
                    </p>
                    <div className="flex min-h-9 flex-wrap items-center gap-2">
                      {presence[room.code] && <RoomPresence people={presence[room.code]} />}
                      <Button
                        size="sm"
                        className="ml-auto"
                        onClick={() => {
                          persistNickname();
                          navigate(`/r/${room.code}`);
                        }}
                        aria-label={`Entrar em ${room.name}`}
                      >
                        Entrar <ArrowRight className="size-4" />
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
