import { ArrowDown, ArrowUp, HeadphoneOff, Lock, LogOut, MicOff, Plus, Star, StarOff, Trash2, Volume2 } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { Link, NavLink, Outlet, useLocation, useMatch, useNavigate } from "react-router-dom";
import { api, ApiError, type Guild, type PresentPerson, type VoiceMember } from "../lib/api";
import { reloadSession, signIn, signOut, useSession } from "../lib/auth";
import { normalizeCode } from "../lib/code";
import { useGuildChannels } from "../lib/guildChannels";
import { usePresence } from "../lib/presence";
import { forgetRoom, useSavedRooms } from "../lib/storage";
import { Avatar, Button, LogoMark, Spinner, buttonClass } from "./ui";

const ShellContext = createContext<{ openNav: () => void } | null>(null);

/** Below lg the nav is a drawer; pages put a button in their header that opens it. Null outside the shell (the Activity). */
export const useShell = () => useContext(ShellContext);

// Tailwind's lg: from here the nav is always on screen.
const WIDE = "(min-width: 64rem)";
const onWideChange = (cb: () => void) => {
  const media = matchMedia(WIDE);
  media.addEventListener("change", cb);
  return () => media.removeEventListener("change", cb);
};

/** The persistent nav (rail + sidebar) is showing, so pages can skip what it already has. */
export const useWideNav = () => useSyncExternalStore(onWideChange, () => matchMedia(WIDE).matches);

/** A sidebar row: a group or a voice channel. */
const rowClass = (current: boolean) =>
  `type-link-sm flex w-full min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition ${current ? "bg-surface-hi text-ink" : "text-soft hover:bg-surface hover:text-ink"
  }`;

const SIDEBAR_PEOPLE = 5;

/** A small icon with its meaning on hover and for screen readers. */
function Flag({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span title={label} className="flex shrink-0">
      {children}
      <span className="sr-only">, {label}</span>
    </span>
  );
}

/** Who is under a row: the Discord call first, then whoever is only in the HypeMeet room. */
function People({ people, voice = [] }: { people: PresentPerson[]; voice?: VoiceMember[] }) {
  const total = voice.length + people.length;
  if (!total) return null;
  const extra = total - SIDEBAR_PEOPLE;
  const shownVoice = voice.slice(0, SIDEBAR_PEOPLE);
  return (
    <ul aria-label={voice.length ? "Pessoas no canal" : "Pessoas na sala"} className="flex flex-col gap-1 pt-0.5 pb-1.5 pl-9">
      {shownVoice.map((m) => (
        <li key={`v:${m.id}`} className="flex min-w-0 items-center gap-2 pr-2 text-[13px] font-semibold text-soft">
          <span aria-hidden className="flex">
            <Avatar name={m.name} seed={m.id} image={m.avatar} size="xs" />
          </span>
          <span className="min-w-0 flex-1 truncate">{m.name}</span>
          {m.inRoom && (
            <Flag label="Também na sala do HypeMeet">
              <LogoMark className="size-3.5" />
            </Flag>
          )}
          {m.mute && (
            <Flag label="microfone desligado">
              <MicOff className="size-3.5" />
            </Flag>
          )}
          {m.deaf && (
            <Flag label="ensurdecido">
              <HeadphoneOff className="size-3.5" />
            </Flag>
          )}
        </li>
      ))}
      {people.slice(0, SIDEBAR_PEOPLE - shownVoice.length).map((p) => (
        <li key={`p:${p.identity}`} className="flex min-w-0 items-center gap-2 text-[13px] font-semibold text-soft">
          <span aria-hidden className="flex">
            <Avatar name={p.name} seed={p.identity} image={p.avatar} size="xs" />
          </span>
          <span className="truncate">{p.name}</span>
        </li>
      ))}
      {extra > 0 && <li className="text-xs font-bold text-soft">+{extra}</li>}
    </ul>
  );
}

/** Rooms made here by code: the saved-rooms list. Polls presence only while on screen (`visible`). */
function Groups({ roomCode, visible }: { roomCode: string | null; visible: boolean }) {
  const savedRooms = useSavedRooms();
  const presence = usePresence(visible ? savedRooms.map((r) => r.code) : []);
  return (
    <>
      <NavLink to="/" end className={({ isActive }) => rowClass(isActive)}>
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-surface">
          <Plus className="size-5" />
        </span>
        Criar ou entrar
      </NavLink>
      {savedRooms.length > 0 && (
        <>
          <p className="type-label px-2 pt-5 pb-2 text-soft">Seus grupos</p>
          <ul className="flex flex-col gap-0.5">
            {savedRooms.map((room) => {
              const current = room.code === roomCode;
              return (
                <li key={room.code} className="group relative">
                  <Link
                    to={`/r/${room.code}`}
                    aria-current={current ? "page" : undefined}
                    className={`${rowClass(current)} pr-11`}
                  >
                    <Avatar name={room.name} seed={room.code} shape="square" size="sm" />
                    <span className="truncate">{room.name}</span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => forgetRoom(room.code)}
                    aria-label={`Remover ${room.name}`}
                    title="Remover da lista"
                    className="absolute top-2 right-1.5 grid size-8 place-items-center rounded-full text-soft opacity-0 transition group-hover:opacity-100 hover:bg-surface-hi hover:text-ink focus-visible:opacity-100 pointer-coarse:opacity-100"
                  >
                    <Trash2 className="size-4" />
                  </button>
                  <People people={presence[room.code] ?? []} />
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}

/** The server's voice channels; key it by the guild so a switch starts clean. */
function Channels({ guild, roomCode }: { guild: Guild; roomCode: string | null }) {
  const navigate = useNavigate();
  const { data, error, retry } = useGuildChannels(guild.id);
  const [opening, setOpening] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ id: string; message: string } | null>(null);

  async function open(channelId: string) {
    if (opening) return;
    setOpening(channelId);
    setFailed(null);
    try {
      const room = await api.channelRoom(guild.id, channelId);
      navigate(`/r/${room.code}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) reloadSession();
      setFailed({ id: channelId, message: (err as Error).message });
    }
    setOpening(null);
  }

  if (!data && error)
    return (
      <div className="flex flex-col items-start gap-3 p-2">
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
        <Button size="sm" onClick={retry}>
          Tentar de novo
        </Button>
      </div>
    );
  if (!data)
    return (
      <div role="status" aria-label="Carregando canais" className="flex flex-col gap-2 p-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-8 rounded-md bg-surface motion-safe:animate-pulse" />
        ))}
      </div>
    );
  if (!data.items.length) return <p className="p-2 text-sm text-soft">Nenhum canal de voz que você possa ver.</p>;

  return (
    <ul className="flex flex-col gap-0.5">
      {data.items.map((item) => {
        if (item.kind === "category")
          return (
            <li key={item.id} className="type-label truncate px-2 pt-5 pb-2 text-soft first:pt-1">
              {item.name}
            </li>
          );
        const current = item.code !== null && item.code === roomCode;
        return (
          <li key={item.id}>
            <button
              type="button"
              disabled={!item.canConnect}
              onClick={() => open(item.id)}
              aria-current={current ? "page" : undefined}
              aria-busy={opening === item.id}
              title={item.canConnect ? undefined : "Você não pode entrar neste canal"}
              className={`${rowClass(current)} disabled:bg-transparent disabled:text-soft disabled:opacity-50`}
            >
              {item.canConnect ? (
                <Volume2 className={`size-5 shrink-0 ${current ? "text-accent-hi" : ""}`} />
              ) : (
                <Lock className="size-5 shrink-0" />
              )}
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              {opening === item.id && <Spinner className="size-4 shrink-0" />}
            </button>
            {failed?.id === item.id && (
              <p role="alert" className="px-2 pt-1 pb-1.5 text-xs font-medium text-danger">
                {failed.message}
              </p>
            )}
            <People people={item.people} voice={item.voice} />
          </li>
        );
      })}
    </ul>
  );
}

function MissingBot({ guild }: { guild: Guild }) {
  return (
    <div className="flex flex-col items-start gap-3 p-2 text-sm font-medium text-soft">
      <p>
        O HypeMeet ainda não está em <span className="font-bold text-ink">{guild.name}</span>.
      </p>
      {guild.addUrl ? (
        <a href={guild.addUrl} target="_blank" rel="noreferrer" className={buttonClass({ variant: "primary", size: "sm" })}>
          Adicionar ao servidor
        </a>
      ) : (
        <p>Peça pra alguém com Gerenciar Servidor adicionar o HypeMeet.</p>
      )}
    </div>
  );
}

function UserPanel() {
  const session = useSession();
  const user = session?.user;
  if (user)
    return (
      <div className="flex items-center gap-2.5 border-t-2 border-line px-3 py-2.5">
        <span aria-hidden className="flex">
          <Avatar name={user.name} seed={user.id} image={user.avatarUrl ?? undefined} size="sm" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[15px] leading-tight font-extrabold">{user.name}</p>
          <p className="truncate text-xs font-medium text-soft">@{user.username}</p>
        </div>
        <button
          type="button"
          onClick={signOut}
          aria-label="Sair da conta"
          title="Sair da conta"
          className="grid size-10 shrink-0 place-items-center rounded-full text-soft transition hover:-translate-y-px hover:bg-surface hover:text-ink active:translate-y-px"
        >
          <LogOut className="size-4.5" />
        </button>
      </div>
    );
  if (!session?.login) return null;
  return (
    <div className="flex flex-col gap-1.5 border-t-2 border-line p-3">
      <Button variant="primary" size="sm" className="w-full" onClick={() => signIn()}>
        Entrar com o Discord
      </Button>
      <p className="text-center text-xs font-medium text-soft">pra ver seus servidores</p>
    </div>
  );
}

/** One rail button; the selected one gets the grape pill on the rail's edge. */
function RailItem({
  label,
  selected,
  dim = false,
  dropTarget = false,
  onClick,
  children,
  ...rest
}: {
  label: string;
  selected: boolean;
  dim?: boolean;
  /** A dragged server would land here. */
  dropTarget?: boolean;
  onClick: () => void;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "onClick" | "children">) {
  return (
    <div {...rest} className={`group relative flex w-full shrink-0 justify-center ${dropTarget ? "before:absolute before:-top-1.5 before:h-0.5 before:w-10 before:rounded-full before:bg-accent-hi" : ""}`}>
      <span
        aria-hidden
        className={`absolute top-1/2 left-0 w-1 -translate-y-1/2 rounded-r-full bg-accent transition-all ${selected ? "h-10" : "h-0 group-hover:h-5"}`}
      />
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        title={label}
        aria-current={selected || undefined}
        className={`rounded-md transition hover:-translate-y-px active:translate-y-px ${dim && !selected ? "opacity-50 hover:opacity-100" : ""}`}
      >
        {children}
      </button>
    </div>
  );
}

/** `id` moved before `beforeId` (null: to the end) with that favourite flag; favourites stay on top. */
function moveBefore(list: Guild[], id: string, beforeId: string | null, favorite: boolean): Guild[] {
  const moved = list.find((g) => g.id === id);
  if (!moved || id === beforeId) return list;
  const rest = list.filter((g) => g.id !== id);
  const at = beforeId ? rest.findIndex((g) => g.id === beforeId) : -1;
  rest.splice(at < 0 ? rest.length : at, 0, { ...moved, favorite });
  return rest.toSorted((a, b) => Number(b.favorite) - Number(a.favorite));
}

/** A small menu pinned beside the rail (fixed: the rail scrolls and would clip it). Escape or a click outside closes it. */
function RailMenu({ at, label, onClose, children }: { at: { x: number; y: number }; label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("button, a")?.focus();
    const onPointer = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      style={{ left: at.x, top: Math.min(at.y, innerHeight - 220) }}
      className="fixed z-[60] flex w-60 animate-pop flex-col gap-0.5 rounded-lg border-2 border-line bg-panel p-2 shadow-float"
    >
      <p className="type-label truncate px-3 pt-1.5 pb-2 text-soft">{label}</p>
      {children}
    </div>
  );
}

const menuItemClass =
  "flex w-full items-center gap-2.5 rounded-full px-3 py-2 text-left text-sm font-semibold text-soft transition hover:bg-surface-hi hover:text-ink disabled:pointer-events-none disabled:opacity-40";

/** Discord-like frame around the home and room pages: servers rail, sidebar, user panel. */
export function AppShell() {
  const location = useLocation();
  const roomCode = useMatch("/r/:code")?.params.code;
  const code = roomCode ? normalizeCode(roomCode) : null;
  const userId = useSession()?.user?.id;
  const [guilds, setGuilds] = useState<Guild[]>([]);
  // A guild id, or null for home (Grupos).
  const [selected, setSelected] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [menu, setMenu] = useState<{ id: string | null; x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState<{ id: string; over: string | null } | null>(null);
  const [reload, setReload] = useState(0);
  const wide = useWideNav();
  const navRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const shell = useMemo(
    () => ({
      openNav: () => {
        // Read before the page goes inert, which may drop focus to <body>.
        openerRef.current = document.activeElement as HTMLElement | null;
        setNavOpen(true);
      },
    }),
    [],
  );

  useEffect(() => {
    if (!userId) return setGuilds([]);
    let cancelled = false;
    const load = () =>
      api.guilds().then(
        (list) => !cancelled && setGuilds(list),
        // The rail just shows home; a 401 means the session ended, so the panel goes back to "Entrar".
        (err) => err instanceof ApiError && err.status === 401 && reloadSession(),
      );
    load();
    // Coming back from adding the bot (another tab, or the browser from the desktop app) or after a failure.
    window.addEventListener("focus", load);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", load);
    };
  }, [userId, reload]);

  // The rail shows servers HypeMeet knows (bot or rooms); the rest only in "+", to add the bot.
  const shown = guilds.filter((g) => g.bot || g.rooms);
  const addable = guilds.filter((g) => !g.bot && !g.rooms && g.addUrl);
  const arrange = (next: Guild[]) => {
    setGuilds(next);
    const kept = next.filter((g) => g.bot || g.rooms);
    // Didn't save → the server's order comes back.
    api
      .saveGuildPrefs({ order: kept.map((g) => g.id), favorites: kept.filter((g) => g.favorite).map((g) => g.id) })
      .catch(() => setReload((n) => n + 1));
  };
  const step = (g: Guild, by: -1 | 1) => {
    const group = shown.filter((x) => x.favorite === g.favorite);
    const i = group.findIndex((x) => x.id === g.id);
    const target = group[i + by];
    if (!target) return;
    if (by < 0) return arrange(moveBefore(guilds, g.id, target.id, g.favorite));
    const after = shown[shown.indexOf(target) + 1];
    arrange(moveBefore(guilds, g.id, after && after.favorite === g.favorite ? after.id : null, g.favorite));
  };
  const menuGuild = menu?.id ? shown.find((g) => g.id === menu.id) : undefined;
  const menuGroup = menuGuild ? shown.filter((x) => x.favorite === menuGuild.favorite) : [];

  // Entering a server channel's room shows that server; only on a new code, so browsing the rail sticks.
  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    api.getRoom(code).then(
      (room) => !cancelled && setSelected(room.discord?.guildId ?? null),
      () => !cancelled && setSelected(null),
    );
    return () => {
      cancelled = true;
    };
  }, [code]);

  useEffect(() => setNavOpen(false), [location]);

  // The open drawer is modal: focus goes in, Escape or growing past lg closes it, focus goes back.
  useEffect(() => {
    if (!navOpen) return;
    const wide = matchMedia(WIDE);
    const close = () => setNavOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    navRef.current?.querySelector<HTMLElement>("button, a")?.focus();
    document.addEventListener("keydown", onKey);
    wide.addEventListener("change", close);
    return () => {
      document.removeEventListener("keydown", onKey);
      wide.removeEventListener("change", close);
      openerRef.current?.focus();
    };
  }, [navOpen]);

  // Not one of yours any more (signed out, or a link to another server's channel) → home.
  const guild = guilds.find((g) => g.id === selected);

  return (
    <ShellContext.Provider value={shell}>
      <div className="flex h-full">
        {navOpen && (
          <div aria-hidden onClick={() => setNavOpen(false)} className="fixed inset-0 z-40 bg-scrim backdrop-blur-sm lg:hidden" />
        )}
        <nav
          ref={navRef}
          aria-label="Servidores e grupos"
          className={`flex shrink-0 max-lg:max-w-[calc(100vw-3rem)] ${navOpen ? "max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-50 max-lg:shadow-float" : "max-lg:hidden"
            }`}
        >
          <div className="flex w-18 shrink-0 flex-col items-center gap-2 overflow-y-auto bg-canvas py-3 scrollbar-thin">
            <RailItem label="Grupos" selected={!guild} onClick={() => setSelected(null)}>
              <LogoMark className="size-12" />
            </RailItem>
            {shown.map((g, i) => (
              <div key={g.id} className="contents">
                {/* One line under Grupos, and another between the favourites and the rest. */}
                {(i === 0 || g.favorite !== shown[i - 1]!.favorite) && (
                  <hr className="my-0.5 h-0.5 w-8 shrink-0 rounded-full border-0 bg-line" />
                )}
                <RailItem
                  label={g.favorite ? `${g.name} (favorito)` : g.name}
                  selected={g.id === guild?.id}
                  dim={!g.bot}
                  dropTarget={!!dragging && dragging.over === g.id && dragging.id !== g.id}
                  onClick={() => setSelected(g.id)}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    setDragging({ id: g.id, over: null });
                  }}
                  onDragOver={(e) => {
                    if (!dragging) return;
                    e.preventDefault();
                    if (dragging.over !== g.id) setDragging({ ...dragging, over: g.id });
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    // Dropped among the favourites makes it one, and the other way round.
                    if (dragging) arrange(moveBefore(guilds, dragging.id, g.id, g.favorite));
                    setDragging(null);
                  }}
                  onDragEnd={() => setDragging(null)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    const box = e.currentTarget.getBoundingClientRect();
                    setMenu({ id: g.id, x: box.right + 6, y: box.top });
                  }}
                >
                  <Avatar name={g.name} seed={g.id} image={g.iconUrl ?? undefined} shape="square" />
                </RailItem>
              </div>
            ))}
            {addable.length > 0 && (
              <button
                type="button"
                aria-label="Adicionar o HypeMeet a um servidor"
                title="Adicionar o HypeMeet a um servidor"
                aria-haspopup="menu"
                aria-expanded={menu?.id === null}
                onClick={(e) => {
                  const box = e.currentTarget.getBoundingClientRect();
                  setMenu(menu?.id === null ? null : { id: null, x: box.right + 6, y: box.top });
                }}
                className="mt-1 grid size-12 shrink-0 place-items-center rounded-md border-2 border-dashed border-line text-soft transition hover:-translate-y-px hover:border-accent-hi hover:text-accent-hi"
              >
                <Plus className="size-5" />
              </button>
            )}
            {shown.length > 1 && (
              <p className="sr-only">Arraste os servidores pra reordenar, ou abra o menu deles (botão direito ou tecla de menu).</p>
            )}
          </div>
          <div className="flex w-64 min-w-0 flex-col border-r-2 border-line bg-panel">
            <div className="flex h-14 shrink-0 items-center border-b-2 border-line px-4">
              <h2 className="truncate font-display text-lg font-extrabold tracking-[-0.01em]">{guild?.name ?? "Grupos"}</h2>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2 scrollbar-thin">
              {!guild ? (
                <Groups roomCode={code} visible={wide || navOpen} />
              ) : guild.bot ? (
                <Channels key={guild.id} guild={guild} roomCode={code} />
              ) : (
                <MissingBot guild={guild} />
              )}
            </div>
            <UserPanel />
          </div>
        </nav>
        {menu && menu.id === null && (
          <RailMenu at={menu} label="Adicionar o HypeMeet" onClose={() => setMenu(null)}>
            {addable.map((g) => (
              <a key={g.id} role="menuitem" href={g.addUrl!} target="_blank" rel="noreferrer" className={menuItemClass} onClick={() => setMenu(null)}>
                <Avatar name={g.name} seed={g.id} image={g.iconUrl ?? undefined} shape="square" size="xs" />
                <span className="truncate">{g.name}</span>
              </a>
            ))}
          </RailMenu>
        )}
        {menuGuild && menu && (
          <RailMenu at={menu} label={menuGuild.name} onClose={() => setMenu(null)}>
            <button
              type="button"
              role="menuitem"
              className={menuItemClass}
              onClick={() => {
                setMenu(null);
                // A new favourite goes to the end of the favourites; an old one to the top of the rest.
                const firstOther = shown.find((x) => !x.favorite && x.id !== menuGuild.id);
                arrange(moveBefore(guilds, menuGuild.id, firstOther?.id ?? null, !menuGuild.favorite));
              }}
            >
              {menuGuild.favorite ? <StarOff className="size-4" /> : <Star className="size-4" />}
              {menuGuild.favorite ? "Tirar dos favoritos" : "Favoritar"}
            </button>
            <button type="button" role="menuitem" className={menuItemClass} disabled={menuGroup[0]?.id === menuGuild.id} onClick={() => step(menuGuild, -1)}>
              <ArrowUp className="size-4" /> Mover pra cima
            </button>
            <button type="button" role="menuitem" className={menuItemClass} disabled={menuGroup.at(-1)?.id === menuGuild.id} onClick={() => step(menuGuild, 1)}>
              <ArrowDown className="size-4" /> Mover pra baixo
            </button>
          </RailMenu>
        )}
        {/* A div, not <main>: pages bring their own landmark. */}
        <div inert={navOpen} className="min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </div>
    </ShellContext.Provider>
  );
}
