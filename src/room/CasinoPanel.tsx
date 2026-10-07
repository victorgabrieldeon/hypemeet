import { useState, useSyncExternalStore, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { COSTUMES, MAX_QUESTION, money, parseAmount, signedMoney, type Session, type Side } from "./casino";
import { getVolumes, setVolume, subscribeVolumes, type CasinoVolumes } from "./casinoAudio";
import { PinComposer, StopButton, ThrowButtons, useCasino } from "./Casino";

const listFormat = new Intl.ListFormat("pt-BR");

const fieldClass =
  "h-10 w-full min-w-0 rounded-sm border border-transparent bg-surface-hi px-3 text-[15px] text-ink outline-none transition placeholder:text-soft/60 focus:border-blurple/70";
const chipClass =
  "type-link-sm flex h-9 items-center justify-center gap-1.5 rounded-sm bg-surface-hi px-3 text-ink transition hover:bg-blurple/25 active:scale-95 disabled:opacity-40 disabled:hover:bg-surface-hi";

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-md border border-line bg-surface p-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="type-label text-soft">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Label({ text, children }: { text: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-soft">
      {text}
      {children}
    </label>
  );
}

/** Reads an optional money field: null when blank, undefined when it isn't a number. */
function optionalAmount(text: string): number | null | undefined {
  if (!text.trim()) return null;
  const parsed = parseAmount(text);
  return parsed && !parsed.relative ? parsed.value : undefined;
}

interface CasinoPanelProps {
  onError: (text: string) => void;
}

/** Popover above the dock: open or run your table, and play along with everyone else's. */
export function CasinoPanel({ onError }: CasinoPanelProps) {
  const store = useCasino();
  const mine = store.myTable;
  const others = store.tables().filter((t) => t.owner !== store.me);
  return (
    <div
      role="dialog"
      aria-label="Mesa"
      className="scrollbar-thin absolute bottom-full left-1/2 z-40 mb-3 flex max-h-[min(40rem,calc(100dvh-8rem))] w-[min(26rem,calc(100vw-1.5rem))] -translate-x-1/2 animate-pop flex-col gap-3 overflow-y-auto rounded-lg bg-panel p-3 shadow-float ring-1 ring-line"
    >
      <div className="flex items-baseline justify-between gap-3 px-1 pt-1">
        <h2 className="type-link">🎰 Mesa</h2>
        <p className="text-xs text-soft">Só zoeira: nada aqui vale dinheiro</p>
      </div>
      {others.map((table) => (
        <TableCard key={table.owner} table={table} />
      ))}
      {mine ? <MyTable table={mine} onError={onError} /> : <OpenTable onError={onError} hasOthers={others.length > 0} />}
      <Volumes />
    </div>
  );
}

function OpenTable({ onError, hasOthers }: { onError: (text: string) => void; hasOthers: boolean }) {
  const store = useCasino();
  const [start, setStart] = useState("");
  const [goal, setGoal] = useState("");
  const [limit, setLimit] = useState("");
  const [big, setBig] = useState("");
  const [open, setOpen] = useState(!hasOthers);

  function submit(e: FormEvent) {
    e.preventDefault();
    const bankroll = parseAmount(start);
    if (!bankroll || bankroll.relative || bankroll.value <= 0) return onError("Digite quanto tem na banca pra começar, tipo 500 ou 1.250,00.");
    const g = optionalAmount(goal);
    const l = optionalAmount(limit);
    const b = optionalAmount(big);
    if (g === undefined || l === undefined || b === undefined) return onError("Meta, limite e “grande” têm que ser valores, tipo 2.000.");
    if (g !== null && g <= bankroll.value) return onError("A meta tem que ser maior que a banca inicial.");
    if (l !== null && l >= bankroll.value) return onError("O limite tem que ser menor que a banca inicial.");
    store.open({ start: bankroll.value, goal: g, limit: l, big: b ?? Math.max(1, Math.round(bankroll.value * 0.2)) });
  }

  if (!open) {
    return (
      <button type="button" className={`${chipClass} h-10`} onClick={() => setOpen(true)}>
        🎰 Abrir minha mesa também
      </button>
    );
  }
  return (
    <Section title="Abrir sua mesa">
      <p className="text-sm text-soft">
        Vai jogar ao vivo? Informe a banca e vá atualizando o saldo: a sala reage a cada vitória e perda. O app não mexe com
        dinheiro nenhum.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-2.5">
        <Label text="Banca inicial">
          <input autoFocus className={fieldClass} inputMode="decimal" placeholder="R$ 500" value={start} onChange={(e) => setStart(e.target.value)} />
        </Label>
        <div className="flex gap-2">
          <Label text="Meta (opcional)">
            <input className={fieldClass} inputMode="decimal" placeholder="Sai com R$ 1.000" value={goal} onChange={(e) => setGoal(e.target.value)} />
          </Label>
          <Label text="Limite (opcional)">
            <input className={fieldClass} inputMode="decimal" placeholder="Para em R$ 200" value={limit} onChange={(e) => setLimit(e.target.value)} />
          </Label>
        </div>
        <Label text="Ganho ou perda “grande” a partir de">
          <input className={fieldClass} inputMode="decimal" placeholder="20% da banca" value={big} onChange={(e) => setBig(e.target.value)} />
        </Label>
        <button type="submit" className="type-link mt-1 h-11 rounded-md bg-blurple text-ink transition hover:brightness-110 active:translate-y-px">
          Abrir mesa
        </button>
      </form>
    </Section>
  );
}

function Balance({ table }: { table: Session }) {
  const diff = table.balance - table.start;
  return (
    <div className="flex items-baseline gap-2">
      <span className="font-display text-2xl font-extrabold tabular-nums">{money(table.balance)}</span>
      <span className={`text-sm font-semibold tabular-nums ${diff > 0 ? "text-win" : diff < 0 ? "text-danger" : "text-soft"}`}>
        {signedMoney(diff)} na noite
      </span>
    </div>
  );
}

function MyTable({ table, onError }: { table: Session; onError: (text: string) => void }) {
  const store = useCasino();
  const [input, setInput] = useState("");
  const [editing, setEditing] = useState(false);
  const [goal, setGoal] = useState(table.goal === null ? "" : String(table.goal));
  const [limit, setLimit] = useState(table.limit === null ? "" : String(table.limit));
  const [big, setBig] = useState(String(table.big));
  const suspense = store.fxOf(table.owner).suspense;

  function update(e: FormEvent) {
    e.preventDefault();
    const amount = parseAmount(input);
    if (!amount) return onError("Digite o saldo atual (1.250) ou quanto mudou (+150, -80).");
    store.setBalance(amount);
    setInput("");
  }

  function saveTargets(e: FormEvent) {
    e.preventDefault();
    const g = optionalAmount(goal);
    const l = optionalAmount(limit);
    const b = optionalAmount(big);
    if (g === undefined || l === undefined || b === undefined || b === null || b <= 0) return onError("Use valores, tipo 2.000.");
    store.setTargets(g, l, b);
    setEditing(false);
  }

  return (
    <>
      <Section title="Sua mesa" aside={<span className="text-xs text-soft">começou com {money(table.start)}</span>}>
        <Balance table={table} />
        <form onSubmit={update} className="flex gap-2">
          <input
            autoFocus
            className={fieldClass}
            inputMode="decimal"
            placeholder="Saldo agora: 1.250 · ou +150 / -80"
            aria-label="Saldo atual ou variação"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button type="submit" disabled={!input.trim()} className="type-link-sm h-10 shrink-0 rounded-sm bg-blurple px-4 text-ink transition hover:brightness-110 disabled:opacity-40">
            Atualizar
          </button>
        </form>
        <div className="grid grid-cols-3 gap-2">
          <button className={chipClass} disabled={!!table.ritual} onClick={() => store.startRitual()} title="5 s pra galera clicar no 🙏 antes do bônus">
            🙏 Ritual
          </button>
          <button className={chipClass} disabled={!!suspense} onClick={() => store.suspend(table.owner)} title="Rufem os tambores">
            ⏳ Vai pagar…
          </button>
          <button
            className={`${chipClass} ${table.music ? "bg-blurple hover:bg-blurple hover:brightness-110" : ""}`}
            aria-pressed={table.music}
            onClick={() => store.setMusic(!table.music)}
            title="Música ambiente pra sala toda; acelera quando o hype sobe"
          >
            🎵 Trilha
          </button>
        </div>
        {editing ? (
          <form onSubmit={saveTargets} className="flex flex-col gap-2 border-t border-line pt-2.5">
            <div className="flex gap-2">
              <Label text="Meta">
                <input className={fieldClass} inputMode="decimal" placeholder="nenhuma" value={goal} onChange={(e) => setGoal(e.target.value)} />
              </Label>
              <Label text="Limite">
                <input className={fieldClass} inputMode="decimal" placeholder="nenhum" value={limit} onChange={(e) => setLimit(e.target.value)} />
              </Label>
              <Label text="Grande">
                <input className={fieldClass} inputMode="decimal" value={big} onChange={(e) => setBig(e.target.value)} />
              </Label>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className={chipClass} onClick={() => setEditing(false)}>
                Cancelar
              </button>
              <button type="submit" className={`${chipClass} bg-blurple hover:bg-blurple hover:brightness-110`}>
                Salvar
              </button>
            </div>
          </form>
        ) : (
          <div className="flex items-center justify-between gap-2 border-t border-line pt-2.5 text-xs text-soft">
            <span>
              🎯 {table.goal === null ? "sem meta" : money(table.goal)} · 🛑 {table.limit === null ? "sem limite" : money(table.limit)} · grande ≥{" "}
              {money(table.big)}
            </span>
            <button className="font-semibold text-blurple-hi hover:underline" onClick={() => setEditing(true)}>
              Editar
            </button>
          </div>
        )}
      </Section>
      <TableExtras table={table} />
      <button
        type="button"
        className="type-link-sm h-10 rounded-md border border-danger/40 text-danger transition hover:bg-danger/15"
        onClick={() => store.close()}
      >
        Fechar mesa
      </button>
    </>
  );
}

/** Someone else's table: follow it and play along. */
function TableCard({ table }: { table: Session }) {
  const store = useCasino();
  const suspense = store.fxOf(table.owner).suspense;
  return (
    <>
      <Section title={`Mesa de ${table.ownerName}`} aside={<span className="text-xs text-soft">começou com {money(table.start)}</span>}>
        <Balance table={table} />
        <div className="grid grid-cols-4 gap-2">
          <StopButton owner={table.owner} className={chipClass} label="Para!" />
          <button className={`${chipClass} col-span-2`} disabled={!!suspense} onClick={() => store.suspend(table.owner)}>
            ⏳ Vai pagar…
          </button>
          <div className="grid grid-cols-2 gap-1">
            <ThrowButtons owner={table.owner} className={`${chipClass} px-0 text-lg`} />
          </div>
        </div>
        <PinComposer owner={table.owner} />
      </Section>
      <TableExtras table={table} />
    </>
  );
}

/** Side bets, the "eu avisei" ranking and who's lucky or jinxed: the same for the owner and everyone else. */
function TableExtras({ table }: { table: Session }) {
  const store = useCasino();
  const name = (id: string) => (id === store.me ? "você" : (table.names[id] ?? "alguém"));
  const ranking = Object.entries(table.avisei)
    .filter(([, points]) => points > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  return (
    <>
      <Bets table={table} name={name} />
      {(table.lucky.length > 0 || table.frozen.length > 0 || table.amulet.holder || ranking.length > 0) && (
        <Section title="Quem é quem">
          <ul className="flex flex-col gap-1 text-sm">
            {table.lucky.length > 0 && (
              <li>
                🍀 <span className="text-soft">Cadeira da sorte:</span> {listFormat.format(table.lucky.map(name))}
              </li>
            )}
            {table.frozen.length > 0 && (
              <li>
                🧊 <span className="text-soft">Pé-frio da noite:</span> {listFormat.format(table.frozen.map(name))}
              </li>
            )}
            {table.amulet.holder && (
              <li>
                {table.amulet.emoji} <span className="text-soft">O {table.amulet.name} está com</span> {name(table.amulet.holder)}
              </li>
            )}
          </ul>
          {ranking.length > 0 && (
            <ol className="mt-1 flex flex-col gap-1 border-t border-line pt-2 text-sm">
              <li className="type-label pb-0.5 text-soft">📢 Placar do “eu avisei”</li>
              {ranking.map(([id, points], i) => (
                <li key={id} className="flex justify-between">
                  <span>
                    {i + 1}. {name(id)}
                  </span>
                  <span className="font-semibold tabular-nums">{points}</span>
                </li>
              ))}
            </ol>
          )}
        </Section>
      )}
    </>
  );
}

function Bets({ table, name }: { table: Session; name: (id: string) => string }) {
  const store = useCasino();
  const [question, setQuestion] = useState("");
  const [costume, setCostume] = useState<string>(COSTUMES[0]);
  const open = table.bets.filter((b) => b.result === null);
  const settled = table.bets.filter((b) => b.result !== null);
  const isOwner = table.owner === store.me;

  function propose(e: FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    store.proposeBet(table.owner, question, costume);
    setQuestion("");
  }

  return (
    <Section title="Apostas de zoeira" aside={<span className="text-xs text-soft">quem errar vira bicho por 1 h</span>}>
      {open.map((bet) => {
        const yes = Object.entries(bet.picks).filter(([, s]) => s === "yes");
        const no = Object.entries(bet.picks).filter(([, s]) => s === "no");
        const my = bet.picks[store.me];
        const canSettle = bet.by === store.me || isOwner;
        const side = (value: Side, label: string, voters: [string, Side][]) => (
          <button
            className={`${chipClass} flex-1 ${my === value ? "bg-blurple hover:bg-blurple hover:brightness-110" : ""}`}
            aria-pressed={my === value}
            onClick={() => store.pickSide(table.owner, bet.id, value)}
            title={voters.length ? voters.map(([id]) => name(id)).join(", ") : "Ninguém ainda"}
          >
            {label} <span className="tabular-nums opacity-70">{voters.length}</span>
          </button>
        );
        return (
          <div key={bet.id} className="flex flex-col gap-2 rounded-sm bg-surface-hi/60 p-2.5">
            <p className="text-sm font-semibold">
              {bet.costume} {bet.question}
            </p>
            <p className="-mt-1.5 text-xs text-soft">proposta por {name(bet.by)}</p>
            <div className="flex gap-2">
              {side("yes", "Sim", yes)}
              {side("no", "Não", no)}
            </div>
            {canSettle && (
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-soft">Resultado:</span>
                <button className="rounded-xs px-1.5 py-0.5 font-semibold text-win hover:bg-white/5" onClick={() => store.settleBet(table.owner, bet.id, "yes")}>
                  deu sim
                </button>
                <button className="rounded-xs px-1.5 py-0.5 font-semibold text-danger hover:bg-white/5" onClick={() => store.settleBet(table.owner, bet.id, "no")}>
                  deu não
                </button>
                <button className="ml-auto rounded-xs px-1.5 py-0.5 text-soft hover:bg-white/5 hover:text-ink" onClick={() => store.settleBet(table.owner, bet.id, null)}>
                  cancelar
                </button>
              </div>
            )}
          </div>
        );
      })}
      {settled.map((bet) => (
        <p key={bet.id} className="text-xs text-soft">
          <span className="text-ink">{bet.question}</span>: deu {bet.result === "yes" ? "sim" : "não"}
          {bet.losers.length > 0 ? ` · ${bet.costume} ${listFormat.format(bet.losers.map(name))}` : " · ninguém errou"}
        </p>
      ))}
      {open.length < 3 ? (
        <form onSubmit={propose} className="flex flex-col gap-2">
          <input
            className={fieldClass}
            maxLength={MAX_QUESTION}
            placeholder="Paga mais de 100x nesse bônus?"
            aria-label="Pergunta da aposta"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <div className="flex items-center gap-1">
            <span className="mr-1 text-xs text-soft">Quem errar vira</span>
            {COSTUMES.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={costume === c}
                onClick={() => setCostume(c)}
                className={`grid size-8 place-items-center rounded-sm text-lg transition ${costume === c ? "bg-blurple" : "hover:bg-surface-hi"}`}
              >
                {c}
              </button>
            ))}
            <button type="submit" disabled={!question.trim()} className={`${chipClass} ml-auto`}>
              Apostar
            </button>
          </div>
        </form>
      ) : (
        <p className="text-xs text-soft">Três apostas abertas: resolve uma antes de abrir outra.</p>
      )}
    </Section>
  );
}

function Slider({ label, kind, volumes }: { label: string; kind: keyof CasinoVolumes; volumes: CasinoVolumes }) {
  const percent = Math.round(volumes[kind] * 100);
  return (
    <label className="flex items-center gap-3 text-sm">
      <span className="w-16 shrink-0 text-soft">{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={percent}
        onChange={(e) => setVolume(kind, Number(e.target.value) / 100)}
        className="range-accent min-w-0 flex-1"
        style={{ "--fill": `${percent}%` } as CSSProperties}
        aria-label={`Volume: ${label}`}
      />
      <span className="w-9 text-right text-xs font-semibold tabular-nums text-ink/75">{percent ? `${percent}%` : "mudo"}</span>
    </label>
  );
}

/** Each listener's own volumes for the table's effects and soundtracks. */
function Volumes() {
  const volumes = useSyncExternalStore(subscribeVolumes, getVolumes);
  return (
    <Section title="Sons da mesa" aside={<span className="text-xs text-soft">só pra você</span>}>
      <Slider label="Efeitos" kind="fx" volumes={volumes} />
      <Slider label="Música" kind="music" volumes={volumes} />
    </Section>
  );
}
