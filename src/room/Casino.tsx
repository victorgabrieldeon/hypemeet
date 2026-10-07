import type { Participant, Room } from "livekit-client";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
} from "react";
import { Avatar } from "../components/ui";
import { useDismiss } from "./menus";
import {
  CasinoStore,
  costumeOf,
  MAX_PIN,
  money,
  NOVELA_STREAK,
  primaryTileId,
  signedMoney,
  THROWABLES,
  type Flight,
  type OwnerFx,
  type Session,
  type Throwable,
} from "./casino";
import { setMusic } from "./casinoAudio";
import type { TileModel } from "./model";
import type { Reactions } from "./reactions";

const CasinoContext = createContext<CasinoStore | null>(null);

/** Creates the room's casino tables store and keeps it listening while the room is open. */
export function useCasinoRoom(room: Room, reactions: Reactions): CasinoStore {
  const store = useMemo(() => new CasinoStore(room), [room]);
  useEffect(() => {
    store.start();
    const off = reactions.store.onAdd(store.onReaction);
    return () => {
      off();
      store.dispose();
    };
  }, [store, reactions]);
  return store;
}

/** Shares the store with the tiles and the dock, and runs the soundtrack. */
export function CasinoProvider({ store, children }: { store: CasinoStore; children: ReactNode }) {
  useSyncExternalStore(store.subscribe, store.getVersion);
  const tables = store.tables();
  // A losing run on a screen we're watching plays the soap opera; otherwise the lounge, if someone put it on.
  const novela = tables.find((t) => t.owner !== store.me && t.streak <= -NOVELA_STREAK && store.watchingScreenOf(t.owner));
  const lounge = tables.find((t) => t.music);
  const music = novela ? "novela" : lounge ? `lounge:${lounge.owner}` : null;
  useEffect(() => {
    if (!music) setMusic(null);
    else if (music === "novela") setMusic("novela", () => 64);
    else {
      const owner = music.slice("lounge:".length);
      // Speeds up as the room gets worked up: 88 bpm when calm, 150 at full hype.
      setMusic("lounge", () => 88 + store.hype(owner) * 62);
    }
  }, [store, music]);
  useEffect(() => () => setMusic(null), []);
  return <CasinoContext.Provider value={store}>{children}</CasinoContext.Provider>;
}

/** The store, re-rendering the caller whenever any table changes. */
export function useCasino(): CasinoStore {
  const store = useContext(CasinoContext);
  if (!store) throw new Error("useCasino outside CasinoProvider");
  useSyncExternalStore(store.subscribe, store.getVersion);
  return store;
}

/** How worked up the room is about someone's table, 0–1, sampled a few times a second. */
function useHype(owner: string): number {
  const store = useCasino();
  const [hype, setHype] = useState(() => store.hype(owner));
  useEffect(() => {
    const tick = () => setHype(Math.round(store.hype(owner) * 50) / 50);
    tick();
    const id = setInterval(tick, 400);
    return () => clearInterval(id);
  }, [store, owner]);
  return hype;
}

/** Milliseconds left until `deadline` (our clock), ticking. */
function useCountdown(deadline: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [deadline]);
  return Math.max(0, deadline - now);
}

const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

// --- avatars and badges ---

const COSTUME_SIZES = { xs: "size-6 text-sm", sm: "size-9 text-xl", md: "size-12 text-2xl", lg: "size-24 text-6xl" };

/** Someone's avatar, or the costume they're wearing after losing a side bet. */
export function PersonAvatar({
  participant,
  size = "md",
  className = "",
}: {
  participant: Participant;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}) {
  const name = participant.name || participant.identity;
  const costume = costumeOf(participant);
  if (!costume) return <Avatar name={name} size={size} className={className} />;
  return (
    <div
      title={`${name} perdeu uma aposta de zoeira`}
      className={`grid shrink-0 place-items-center rounded-full bg-surface-hi leading-none ${COSTUME_SIZES[size]} ${className}`}
    >
      {costume}
    </div>
  );
}

/** 🍀 lucky seat, 🧊 the night's jinx, the amulet: next to someone's name. */
export function CasinoBadges({ identity }: { identity: string }) {
  const store = useCasino();
  const badges: { emoji: string; title: string }[] = [];
  const tables = store.tables();
  if (tables.some((t) => t.lucky.includes(identity)))
    badges.push({ emoji: "🍀", title: "Cadeira da sorte: estava assistindo na última vitória" });
  if (tables.some((t) => t.frozen.includes(identity)))
    badges.push({ emoji: "🧊", title: "Pé-frio da noite: assistiu à pior sequência de perdas" });
  for (const t of tables)
    if (t.amulet.holder === identity) badges.push({ emoji: t.amulet.emoji, title: `Está com o ${t.amulet.name} da mesa de ${t.ownerName}` });
  if (!badges.length) return null;
  return (
    <span className="flex shrink-0 gap-0.5 leading-none">
      {badges.map((b) => (
        <span key={b.emoji} title={b.title} aria-label={b.title}>
          {b.emoji}
        </span>
      ))}
    </span>
  );
}

// --- what the tile's picture goes through ---

/**
 * Wraps a tile's picture: black and white during a losing run (colour snaps back on the next win),
 * a slow dramatic zoom while the drum rolls.
 */
export function CasinoFrame({ tile, children }: { tile: TileModel; children: ReactNode }) {
  const store = useCasino();
  const owner = tile.participant.identity;
  const table = store.table(owner);
  const primary = !!table && primaryTileId(tile.participant) === tile.id;
  const novela = primary && table.streak <= -NOVELA_STREAK;
  const zoom = primary && store.fxOf(owner).suspense?.result === null;
  return (
    <div className={`absolute inset-0 ${novela ? "casino-novela" : ""} ${zoom ? "casino-zoom" : "casino-unzoom"}`}>
      {children}
    </div>
  );
}

// --- overlays ---

/** Everything a table shows over its tile; also the disco lights and thrown tomatoes on any tile. */
export function CasinoLayer({ tile, compact, inkActive }: { tile: TileModel; compact?: boolean; inkActive?: boolean }) {
  const store = useCasino();
  const owner = tile.participant.identity;
  const table = store.table(owner);
  const flights = store.flightsOn(tile.id);
  const disco = store.disco;
  if (!table && !disco && !flights.length) return null;
  const primary = !!table && primaryTileId(tile.participant) === tile.id;
  const fx = store.fxOf(owner);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg [container-type:size]">
      {table && tile.kind === "camera" && <Thermometer owner={owner} compact={compact} />}
      {disco && <div className="casino-disco absolute inset-0 rounded-lg" />}
      {primary && fx.flash && <div key={fx.flash.id} className="casino-flash absolute inset-0" />}
      {flights.map((f) => (
        <FlightView key={f.id} flight={f} compact={compact} />
      ))}
      {table && primary && (
        <>
          {!inkActive && <Hud table={table} compact={compact} side={tile.kind === "camera" ? "left" : "right"} />}
          {fx.plaque && <Plaque key={fx.plaque.id} amount={fx.plaque.amount} compact={compact} />}
          {!compact && (
            <>
              {fx.pin && <PinnedComment key={fx.pin.id} pin={fx.pin} />}
              <Stops stops={fx.stops} />
              {fx.suspense && <Suspense owner={owner} suspense={fx.suspense} />}
              {table.ritual && <Ritual key={table.ritual.id} table={table} />}
              {/* The narrator sits above the hover bar; a vote card takes the bottom and pushes it up. */}
              <div className={`absolute inset-x-2 flex flex-col items-center gap-2 ${table.vote ? "bottom-2" : "bottom-[18%]"}`}>
                {fx.caption && <Caption key={fx.caption.id} caption={fx.caption} />}
                {table.vote && <VoteCard key={table.vote.id} table={table} />}
              </div>
            </>
          )}
        </>
      )}
      {table && store.dragging && <DropZone tileId={tile.id} />}
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values.map((v, i) => `${(i / (values.length - 1)) * 64},${18 - ((v - min) / span) * 16}`).join(" ");
  const up = values.at(-1)! >= values[0]!;
  return (
    <svg viewBox="0 0 64 20" className="h-4 w-14" aria-hidden>
      <polyline points={points} fill="none" strokeWidth={1.6} strokeLinejoin="round" className={up ? "stroke-win" : "stroke-danger"} />
    </svg>
  );
}

/**
 * Balance in the corner: up or down on the night, the current run, the last ritual. On a camera it
 * goes left, under the thermometer, clear of the camera's hover buttons.
 */
function Hud({ table, compact, side }: { table: Session; compact?: boolean; side: "left" | "right" }) {
  const diff = table.balance - table.start;
  const run = Math.abs(table.streak);
  const corner = side === "right" ? "top-2 right-2 items-end" : `left-2 items-start ${compact ? "top-2" : "top-10"}`;
  return (
    <div className={`absolute flex max-w-[60%] flex-col gap-1.5 ${corner}`}>
      <div
        className="flex items-center gap-1.5 rounded-sm bg-black/70 px-2.5 py-1 backdrop-blur-md"
        title={`Mesa de ${table.ownerName}: começou com ${money(table.start)}`}
      >
        <span aria-hidden>🎰</span>
        <span className="type-link-sm tabular-nums">{money(table.balance)}</span>
        {!compact && (
          <>
            <span className={`text-xs font-semibold tabular-nums ${diff > 0 ? "text-win" : diff < 0 ? "text-danger" : "text-ink/60"}`}>
              {diff > 0 ? "▲" : diff < 0 ? "▼" : "•"} {signedMoney(diff)}
            </span>
            <Sparkline values={table.history} />
            {run >= 2 && (
              <span className="text-xs font-bold tabular-nums" title={table.streak > 0 ? "Vitórias seguidas" : "Perdas seguidas"}>
                {table.streak > 0 ? "🔥" : "📉"}
                {run}
              </span>
            )}
          </>
        )}
      </div>
      {!compact && (table.prayed !== null || table.goal !== null || table.limit !== null) && (
        <div className={`flex flex-wrap gap-1.5 text-xs font-semibold ${side === "right" ? "justify-end" : ""}`}>
          {table.prayed !== null && table.prayed > 0 && (
            <span className="rounded-sm bg-black/70 px-2 py-0.5 backdrop-blur-md">
              🙏 {table.prayed} {table.prayed > 1 ? "rezaram" : "rezou"}
            </span>
          )}
          {table.goal !== null && <span className="rounded-sm bg-black/70 px-2 py-0.5 backdrop-blur-md">🎯 {money(table.goal)}</span>}
          {table.limit !== null && <span className="rounded-sm bg-black/70 px-2 py-0.5 backdrop-blur-md">🛑 {money(table.limit)}</span>}
        </div>
      )}
    </div>
  );
}

const CAPTION_TONES: Record<NonNullable<OwnerFx["caption"]>["kind"], string> = {
  win: "bg-linear-to-b from-[#ffd84d] to-[#f5a524] text-ink-dark",
  goal: "bg-linear-to-b from-[#ffd84d] to-[#f5a524] text-ink-dark",
  loss: "bg-[#2a0d14]/90 text-ink ring-1 ring-danger/50",
  limit: "bg-danger text-ink",
  note: "bg-black/80 text-ink ring-1 ring-white/10",
};

/** The narrator's line. */
function Caption({ caption }: { caption: NonNullable<OwnerFx["caption"]> }) {
  return (
    <div className={`casino-caption max-w-full rounded-md px-4 py-2 text-center shadow-float backdrop-blur-md ${CAPTION_TONES[caption.kind]}`}>
      <p className="font-display text-[clamp(15px,4.2cqmin,30px)] leading-tight font-extrabold">{caption.text}</p>
      {caption.notes.map((n) => (
        <p key={n} className="mt-0.5 text-[clamp(11px,2.4cqmin,15px)] leading-snug font-semibold opacity-85">
          {n}
        </p>
      ))}
    </div>
  );
}

/** "Aqui jazia R$ 200": drops in over a big loss. */
function Plaque({ amount, compact }: { amount: number; compact?: boolean }) {
  return (
    <div className="absolute inset-x-0 top-[8%] flex justify-center">
      <div
        className={`casino-plaque flex flex-col items-center rounded-t-[999px] rounded-b-md bg-linear-to-b from-[#4a4a58] to-[#1d1d26] text-center shadow-float ring-1 ring-white/15 ${compact ? "px-3 pt-3 pb-1.5" : "px-[6cqmin] pt-[6cqmin] pb-[2.5cqmin]"}`}
      >
        <span className={compact ? "text-lg" : "text-[clamp(22px,7cqmin,48px)]"}>🕯️</span>
        <span className="type-label text-ink/70">Aqui jazia</span>
        <span className={`font-display font-extrabold tabular-nums ${compact ? "text-sm" : "text-[clamp(18px,6cqmin,44px)]"}`}>
          {money(amount)}
        </span>
      </div>
    </div>
  );
}

function PinnedComment({ pin }: { pin: NonNullable<OwnerFx["pin"]> }) {
  return (
    <div className="absolute inset-x-3 top-[22%] flex justify-center">
      <div className="casino-pin max-w-[min(32rem,100%)] rounded-sm bg-[#fff6c2] px-4 py-2 text-ink-dark shadow-float">
        <p className="text-[clamp(14px,3.6cqmin,24px)] leading-snug font-bold break-words">📌 “{pin.text}”</p>
        <p className="text-right text-xs font-semibold opacity-70">— {pin.name}</p>
      </div>
    </div>
  );
}

function Stops({ stops }: { stops: OwnerFx["stops"] }) {
  if (!stops.length) return null;
  return (
    <div className="absolute top-1/2 right-2 flex -translate-y-1/2 flex-col items-end gap-1.5">
      {stops.map((s) => (
        <div key={s.id} className="casino-stop rounded-full bg-danger px-3 py-1 text-sm font-bold text-ink shadow-float">
          🛑 {s.name === "você" ? "Você mandou parar" : `${s.name} mandou parar`}
        </div>
      ))}
    </div>
  );
}

/** "Vai pagar…": the drum rolls until someone calls it (or the balance moves). */
function Suspense({ owner, suspense }: { owner: string; suspense: NonNullable<OwnerFx["suspense"]> }) {
  const store = useCasino();
  if (suspense.result) {
    return (
      <div className="absolute inset-0 grid place-items-center">
        <p
          className={`casino-stamp rounded-lg px-6 py-3 font-display text-[clamp(26px,10cqmin,80px)] font-extrabold shadow-float ${suspense.result === "paid" ? "bg-linear-to-b from-[#ffd84d] to-[#f5a524] text-ink-dark" : "bg-black/85 text-ink"}`}
        >
          {suspense.result === "paid" ? "💰 PAGOU!" : "💀 NÃO PAGOU"}
        </p>
      </div>
    );
  }
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
      <p className="animate-pulse rounded-md bg-black/75 px-5 py-2 font-display text-[clamp(18px,6cqmin,46px)] font-extrabold backdrop-blur-md">
        ⏳ Vai pagar…
      </p>
      <p className="rounded-full bg-black/60 px-2.5 py-0.5 text-xs font-semibold text-ink/80">
        {suspense.by === "você" ? "Você chamou" : `${suspense.by} chamou`}
      </p>
      <div className="pointer-events-auto mt-1 flex justify-center gap-2" onDoubleClick={stop}>
        <button
          onClick={() => store.callResult(owner, "paid")}
          className="type-link-sm h-10 rounded-full bg-linear-to-b from-[#ffd84d] to-[#f5a524] px-4 text-ink-dark shadow-float transition hover:brightness-110 active:scale-95"
        >
          💰 Pagou!
        </button>
        <button
          onClick={() => store.callResult(owner, "nope")}
          className="type-link-sm h-10 rounded-full bg-black/80 px-4 text-ink shadow-float ring-1 ring-white/15 transition hover:bg-black active:scale-95"
        >
          💀 Não pagou
        </button>
      </div>
    </div>
  );
}

function Ring({ fraction, children, className = "" }: { fraction: number; children: ReactNode; className?: string }) {
  return (
    <div className={`relative grid place-items-center ${className}`}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r="46" fill="none" strokeWidth="6" className="stroke-white/15" />
        <circle
          cx="50"
          cy="50"
          r="46"
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={`${fraction * 100} 100`}
          className="stroke-[#ffd84d]"
        />
      </svg>
      {children}
    </div>
  );
}

/** Five seconds to pray before the streamer buys the bonus. */
function Ritual({ table }: { table: Session }) {
  const store = useCasino();
  const ritual = table.ritual!;
  const left = useCountdown(store.localTime(table.owner, ritual.endsAt));
  const [prayed, setPrayed] = useState(false);
  const isOwner = table.owner === store.me;
  const done = prayed || ritual.prayers.includes(store.me);
  const count = ritual.prayers.length;
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div className="flex flex-col items-center gap-2">
        <Ring fraction={left / 5000} className="size-[clamp(84px,26cqmin,150px)]">
          {isOwner || done ? (
            <span className="text-[clamp(30px,10cqmin,60px)]">🙏</span>
          ) : (
            <button
              onClick={() => {
                setPrayed(true);
                store.pray(table.owner);
              }}
              onDoubleClick={stop}
              className="casino-pray pointer-events-auto grid size-[86%] place-items-center rounded-full bg-black/70 text-[clamp(30px,10cqmin,60px)] backdrop-blur-md transition hover:scale-105 active:scale-90"
              aria-label="Rezar"
            >
              🙏
            </button>
          )}
        </Ring>
        <p className="rounded-full bg-black/75 px-3 py-1 text-sm font-bold backdrop-blur-md">
          {isOwner
            ? `Ritual: ${count} rezando…`
            : done
              ? `Rezou ✓ · ${count} rezando`
              : `Clique pra rezar · ${Math.ceil(left / 1000)}s`}
        </p>
      </div>
    </div>
  );
}

function VoteCard({ table }: { table: Session }) {
  const store = useCasino();
  const vote = table.vote!;
  const left = useCountdown(store.localTime(table.owner, vote.endsAt));
  const [picked, setPicked] = useState<number | null>(null);
  const mine = vote.ballots[store.me] ?? picked;
  const canVote = table.owner !== store.me && !vote.subjects.includes(store.me) && left > 0;
  const total = vote.kind === "stop" ? 20_000 : 15_000;
  return (
    <div
      className="pointer-events-auto w-[min(19rem,100%)] animate-pop overflow-hidden rounded-md bg-black/85 shadow-float ring-1 ring-white/10 backdrop-blur-md"
      onDoubleClick={stop}
    >
      <div className="p-3">
        <p className="type-label flex justify-between text-ink/70">
          <span>{vote.kind === "stop" ? "🚨 Hora de parar?" : "📢 Eu avisei"}</span>
          <span className="tabular-nums">{Math.ceil(left / 1000)}s</span>
        </p>
        <p className="mt-1.5 text-sm leading-snug font-semibold">{vote.question}</p>
        <div className="mt-2.5 flex gap-2">
          {vote.options.map((option, i) => {
            const count = Object.values(vote.ballots).filter((b) => b === i).length;
            return (
              <button
                key={option}
                disabled={!canVote}
                onClick={() => {
                  setPicked(i);
                  store.ballot(table.owner, i);
                }}
                className={`type-link-sm flex h-9 flex-1 items-center justify-center gap-2 rounded-sm transition disabled:cursor-default ${mine === i ? "bg-blurple text-ink" : "bg-white/10 text-ink enabled:hover:bg-white/20"}`}
              >
                {option}
                <span className="tabular-nums opacity-75">{count}</span>
              </button>
            );
          })}
        </div>
        {!canVote && left > 0 && (
          <p className="mt-2 text-xs text-ink/60">
            {table.owner === store.me ? "A galera está votando…" : vote.subjects.includes(store.me) ? "É sobre você: os outros decidem" : ""}
          </p>
        )}
      </div>
      <div className="h-1 bg-blurple-hi transition-[width] duration-100 ease-linear" style={{ width: `${(left / total) * 100}%` }} />
    </div>
  );
}

/** 🍅 / 🌹: click to throw at the table, or drag onto any of its tiles. */
export function ThrowButtons({ owner, tileId, className = "" }: { owner: string; tileId?: string; className?: string }) {
  const store = useCasino();
  const onDragStart = (item: Throwable) => (e: DragEvent) => {
    e.dataTransfer.setData("text/plain", THROWABLES[item].emoji);
    e.dataTransfer.effectAllowed = "copy";
    // Changing the DOM during dragstart can cancel the drag in Chromium: show the drop zones next tick.
    setTimeout(() => store.setDragging(item));
  };
  return (
    <>
      {(Object.keys(THROWABLES) as Throwable[]).map((item) => (
        <button
          key={item}
          draggable
          onDragStart={onDragStart(item)}
          onDragEnd={() => store.setDragging(null)}
          onClick={(e) => {
            e.stopPropagation();
            const target = tileId ?? store.primaryTileOf(owner);
            if (target) store.throwAt(target, item, 0.25 + Math.random() * 0.5, 0.2 + Math.random() * 0.5);
          }}
          onDoubleClick={stop}
          title={`${THROWABLES[item].label}: clique pra jogar ou arraste até a tela`}
          aria-label={`Jogar ${THROWABLES[item].label.toLowerCase()}`}
          className={`cursor-grab active:cursor-grabbing ${className}`}
        >
          {THROWABLES[item].emoji}
        </button>
      ))}
    </>
  );
}

/** Shown on every tile of a table while a tomato or rose is being dragged. */
function DropZone({ tileId }: { tileId: string }) {
  const store = useCasino();
  const [over, setOver] = useState(false);
  return (
    <div
      className={`pointer-events-auto absolute inset-0 grid place-items-center rounded-lg border-4 border-dashed transition ${over ? "border-[#ffd84d] bg-[#ffd84d]/15" : "border-white/30 bg-black/20"}`}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragEnter={() => setOver(true)}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        const item = store.dragging;
        store.setDragging(null);
        if (!item) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
        store.throwAt(tileId, item, x, y);
      }}
    >
      <span className="pointer-events-none rounded-full bg-black/70 px-3 py-1 text-sm font-bold">Solta aqui!</span>
    </div>
  );
}

/** A tomato or rose flying from the bottom edge onto the screen. */
function FlightView({ flight, compact }: { flight: Flight; compact?: boolean }) {
  const style = {
    left: `${flight.x * 100}%`,
    top: `${flight.y * 100}%`,
    "--dx": `${(flight.fromX - flight.x) * 100}cqw`,
    "--dy": `${(1.15 - flight.y) * 100}cqh`,
  } as CSSProperties;
  const tomato = flight.item === "tomato";
  return (
    <div className="absolute size-0" style={style} aria-hidden>
      {tomato ? (
        <div className="casino-splat absolute size-[24cqmin] -translate-1/2 rounded-[46%_54%_42%_58%/55%_45%_55%_45%] bg-[radial-gradient(circle_at_45%_45%,#ff4b4b_0_40%,#c8102e_62%,transparent_64%)]" />
      ) : (
        [0, 1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            className="casino-petal absolute -translate-1/2 text-[clamp(10px,3.5cqmin,22px)]"
            style={{ "--a": `${i * 60 + 15}deg` } as CSSProperties}
          >
            🌸
          </span>
        ))
      )}
      <span className={`absolute -translate-1/2 text-[clamp(26px,10cqmin,68px)] ${tomato ? "casino-fly-squash" : "casino-fly-land"}`}>
        {THROWABLES[flight.item].emoji}
      </span>
      {!compact && (
        <span className="casino-thrower absolute top-[6cqmin] -translate-x-1/2 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap">
          {flight.name}
        </span>
      )}
    </div>
  );
}

/** The streamer's camera warms up with the room: a border that goes from cool to red, and a fever reading. */
function Thermometer({ owner, compact }: { owner: string; compact?: boolean }) {
  const hype = useHype(owner);
  const hue = 200 - hype * 200;
  const temp = (36 + hype * 6).toFixed(1).replace(".", ",");
  return (
    <>
      <div
        className={`absolute inset-0 rounded-lg transition-[box-shadow] duration-500 ${hype > 0.8 ? "animate-pulse" : ""}`}
        style={{
          boxShadow: `inset 0 0 0 ${2 + hype * 4}px hsl(${hue} 95% 55% / ${0.3 + hype * 0.7}), inset 0 0 ${8 + hype * 48}px hsl(${hue} 95% 50% / ${hype * 0.75})`,
        }}
      />
      {!compact && (
        <div
          className="absolute top-2 left-2 flex items-center gap-1 rounded-sm bg-black/65 px-2 py-0.5 text-[13px] font-semibold tabular-nums backdrop-blur-md"
          title="Termômetro de nervoso: sobe com as reações da sala"
        >
          🌡️ <span style={{ color: `hsl(${hue} 95% 65%)` }}>{temp}°</span>
        </div>
      )}
    </>
  );
}

/**
 * 🎰 in the tile's hover bar, on the tile carrying a table: opens the quick actions — drum roll and
 * ritual for the streamer; drum roll, "para!", a pinned comment, tomatoes and roses for everyone else.
 */
export function CasinoTileButton({ tile, placement = "up" }: { tile: TileModel; placement?: "up" | "down" }) {
  const store = useCasino();
  const [open, setOpen] = useState(false);
  const [pinning, setPinning] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => {
    setOpen(false);
    setPinning(false);
  });
  const table = store.table(tile.participant.identity);
  if (!table || primaryTileId(tile.participant) !== tile.id) return null;
  const isOwner = table.owner === store.me;
  const suspense = store.fxOf(table.owner).suspense;
  const button =
    "grid size-9 shrink-0 place-items-center rounded-full bg-black/75 text-lg leading-none backdrop-blur-md transition hover:bg-black active:scale-90 disabled:opacity-40";
  return (
    <div ref={ref} className="relative" onDoubleClick={stop} onClick={stop}>
      <button
        className={`grid size-9 place-items-center rounded-full text-lg leading-none backdrop-blur-md transition ${open ? "bg-blurple hover:brightness-110" : "bg-black/65 hover:bg-black/85"}`}
        onClick={() => setOpen(!open)}
        aria-label="Interagir com a mesa"
        aria-expanded={open}
        title="Interagir com a mesa"
      >
        🎰
      </button>
      {open && (
        <div className={`absolute right-0 z-10 flex w-max flex-col items-end gap-1.5 ${placement === "up" ? "bottom-full mb-2" : "top-full mt-2 flex-col-reverse"}`}>
          {pinning && (
            <div className="w-64">
              <PinComposer
                owner={table.owner}
                autoFocus
                onDone={() => {
                  setPinning(false);
                  setOpen(false);
                }}
              />
            </div>
          )}
          <div className="flex animate-pop gap-1.5 rounded-full bg-black/40 p-1 backdrop-blur-md">
            <button className={button} disabled={!!suspense} onClick={() => store.suspend(table.owner)} title="Vai pagar… (rufem os tambores)" aria-label="Vai pagar">
              ⏳
            </button>
            {isOwner ? (
              <button className={button} disabled={!!table.ritual} onClick={() => store.startRitual()} title="Ritual: 5 s pra galera rezar" aria-label="Começar ritual">
                🙏
              </button>
            ) : (
              <>
                <StopButton owner={table.owner} className={button} />
                <button className={button} onClick={() => setPinning(!pinning)} title="Fixar um comentário na tela" aria-label="Fixar comentário" aria-expanded={pinning}>
                  📌
                </button>
                <ThrowButtons owner={table.owner} tileId={tile.id} className={button} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** "Para!": tells the streamer to quit; counts for "eu avisei" if a loss follows. */
export function StopButton({ owner, className, label }: { owner: string; className: string; label?: string }) {
  const store = useCasino();
  const cooldown = store.stopCooldown();
  const [, rerender] = useState(0);
  useEffect(() => {
    if (!cooldown) return;
    const id = setTimeout(() => rerender((n) => n + 1), cooldown + 50);
    return () => clearTimeout(id);
  }, [cooldown]);
  return (
    <button
      className={className}
      disabled={cooldown > 0}
      onClick={() => store.callStop(owner)}
      title={cooldown > 0 ? "Já mandou parar, espera um pouco" : "Mandar parar (vale ponto de \"eu avisei\" se vier perda)"}
      aria-label="Mandar parar"
    >
      🛑{label && <span>{label}</span>}
    </button>
  );
}

/** One line pinned over the table for 10 s; once every couple of minutes per person. */
export function PinComposer({ owner, onDone, autoFocus }: { owner: string; onDone?: () => void; autoFocus?: boolean }) {
  const store = useCasino();
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const cooldown = store.pinCooldown();
  const [, rerender] = useState(0);
  useEffect(() => {
    if (!cooldown) return;
    const id = setInterval(() => rerender((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [cooldown]);
  const send = () => {
    if (store.pin(owner, text)) {
      setText("");
      onDone?.();
    }
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
      className="flex items-center gap-1.5 rounded-md bg-black/80 p-1.5 ring-1 ring-white/10 backdrop-blur-md"
      onDoubleClick={stop}
    >
      <input
        ref={input}
        autoFocus={autoFocus}
        value={text}
        maxLength={MAX_PIN}
        disabled={cooldown > 0}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onDone?.()}
        placeholder={cooldown > 0 ? `Próximo em ${Math.ceil(cooldown / 1000)}s` : "ele não vai parar…"}
        aria-label="Comentário pra fixar na tela"
        className="h-8 min-w-0 flex-1 rounded-sm bg-white/10 px-2.5 text-sm text-ink outline-none placeholder:text-ink/50 focus:bg-white/15"
      />
      <button
        type="submit"
        disabled={cooldown > 0 || !text.trim()}
        className="type-link-sm h-8 shrink-0 rounded-sm bg-blurple px-3 text-ink transition hover:brightness-110 disabled:opacity-40"
      >
        Fixar
      </button>
    </form>
  );
}

/** Dot on the dock button while someone has a table open. */
export function CasinoLiveDot() {
  const store = useCasino();
  if (!store.tables().length) return null;
  return <span className="absolute top-0 right-0 size-3 rounded-full bg-[#ffd84d] ring-2 ring-panel" aria-label="Mesa aberta" />;
}
