import { Check, Plus, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { MAX_OPTION, MAX_POLL_OPTIONS, MAX_QUESTION, MIN_POLL_OPTIONS, type ChatMessage } from "./chat";

const fieldClass =
  "h-11 w-full min-w-0 rounded-md border-2 border-line bg-surface px-3.5 text-sm font-medium text-ink outline-none transition placeholder:text-soft focus:border-accent";

/** Takes the place of the message box while a poll is being written. */
export function PollComposer({
  onCreate,
  onCancel,
}: {
  onCreate: (question: string, options: string[], multiple: boolean) => void;
  onCancel: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [multiple, setMultiple] = useState(false);
  const optionRefs = useRef<(HTMLInputElement | null)[]>([]);
  /** Option to focus once it's rendered. */
  const focusOption = useRef<number | null>(null);

  useEffect(() => {
    if (focusOption.current === null) return;
    optionRefs.current[focusOption.current]?.focus();
    focusOption.current = null;
  });

  const filled = options.map((o) => o.trim()).filter(Boolean);
  const duplicate = new Set(filled.map((o) => o.toLocaleLowerCase("pt-BR"))).size < filled.length;
  const ready = !!question.trim() && filled.length >= MIN_POLL_OPTIONS && !duplicate;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (ready) onCreate(question.trim(), filled, multiple);
  }

  function addOption() {
    focusOption.current = options.length;
    setOptions([...options, ""]);
  }

  /** Enter moves on to the next field (adding an option at the end) instead of submitting half a poll. */
  function onOptionKey(e: KeyboardEvent<HTMLInputElement>, i: number) {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (i < options.length - 1) optionRefs.current[i + 1]?.focus();
    else if (options[i]!.trim() && options.length < MAX_POLL_OPTIONS) addOption();
    else if (ready) onCreate(question.trim(), filled, multiple);
  }

  return (
    <form
      onSubmit={submit}
      onKeyDown={(e) => e.key === "Escape" && onCancel()}
      aria-label="Nova enquete"
      className="scrollbar-thin flex max-h-[65vh] flex-col gap-3 overflow-y-auto"
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="poll-question" className="type-label text-soft">
          Pergunta
        </label>
        <input
          id="poll-question"
          autoFocus
          value={question}
          maxLength={MAX_QUESTION}
          placeholder="O que você quer perguntar?"
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
            e.preventDefault();
            optionRefs.current[0]?.focus();
          }}
          className={fieldClass}
        />
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="type-label mb-1.5 text-soft">Respostas</legend>
        {options.map((option, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              ref={(el) => void (optionRefs.current[i] = el)}
              value={option}
              maxLength={MAX_OPTION}
              placeholder={`Resposta ${i + 1}`}
              aria-label={`Resposta ${i + 1}`}
              onChange={(e) => setOptions(options.map((o, j) => (j === i ? e.target.value : o)))}
              onKeyDown={(e) => onOptionKey(e, i)}
              className={fieldClass}
            />
            {options.length > MIN_POLL_OPTIONS && (
              <button
                type="button"
                onClick={() => setOptions(options.filter((_, j) => j !== i))}
                aria-label={`Remover resposta ${i + 1}`}
                title="Remover"
                className="grid size-9 shrink-0 place-items-center rounded-full text-soft transition hover:-translate-y-px hover:bg-surface-hi hover:text-ink active:translate-y-px"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        ))}
        {options.length < MAX_POLL_OPTIONS && (
          <button
            type="button"
            onClick={addOption}
            className="type-link-sm flex h-9 items-center gap-1.5 self-start rounded-full px-3 text-accent-hi transition hover:-translate-y-px hover:bg-surface-hi active:translate-y-px"
          >
            <Plus className="size-4" /> Adicionar resposta
          </button>
        )}
        {duplicate && <p className="px-0.5 text-xs font-bold text-danger">Tem resposta repetida.</p>}
      </fieldset>

      <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={multiple}
          onChange={(e) => setMultiple(e.target.checked)}
          className="size-4 accent-accent"
        />
        Permitir mais de uma resposta
      </label>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="type-link-sm h-10 rounded-full px-4 text-soft transition hover:-translate-y-px hover:bg-surface-hi hover:text-ink active:translate-y-px"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={!ready}
          className="type-link-sm h-10 rounded-full border-2 border-accent-hi bg-accent px-4 text-on-accent shadow-sticker transition hover:-translate-y-px hover:bg-accent-hi active:translate-y-px active:shadow-none disabled:translate-y-0 disabled:bg-accent disabled:opacity-50"
        >
          Criar enquete
        </button>
      </div>
    </form>
  );
}

const votersLabel = (n: number) => (n === 0 ? "Ninguém votou ainda" : n === 1 ? "1 pessoa votou" : `${n} pessoas votaram`);

/** A poll in the conversation: the options double as the vote buttons and the result bars. */
export function PollCard({
  message,
  me,
  onVote,
  onClosePoll,
}: {
  message: ChatMessage & { poll: NonNullable<ChatMessage["poll"]> };
  /** Our identity. */
  me: string;
  onVote: (choices: number[]) => void;
  onClosePoll: () => void;
}) {
  const { poll } = message;
  const [confirming, setConfirming] = useState(false);
  const names = poll.options.map(() => [] as string[]);
  let voters = 0;
  for (const [identity, vote] of Object.entries(poll.votes)) {
    if (!vote.choices.length) continue;
    voters++;
    for (const choice of vote.choices) names[choice]?.push(identity === me ? "você" : vote.name);
  }
  const mine = poll.votes[me]?.choices ?? [];
  const top = Math.max(...names.map((n) => n.length));
  const canVote = !poll.closed && !message.failed;

  function choose(i: number) {
    if (!canVote) return;
    // Picking your own choice again takes it back.
    if (mine.includes(i)) onVote(mine.filter((c) => c !== i));
    else onVote(poll.multiple ? [...mine, i] : [i]);
  }

  return (
    <div className="w-full rounded-lg border-2 border-line bg-surface p-3.5 whitespace-normal">
      <p className="font-display text-base leading-snug font-extrabold break-words">{message.text}</p>
      <p className="mt-1 text-xs font-medium text-soft">
        {poll.closed ? "Enquete encerrada" : poll.multiple ? "Escolha uma ou mais respostas" : "Escolha uma resposta"}
      </p>
      <div role="group" aria-label={message.text} className="mt-3 flex flex-col gap-2">
        {poll.options.map((option, i) => {
          const count = names[i]!.length;
          const percent = voters ? Math.round((count / voters) * 100) : 0;
          const chosen = mine.includes(i);
          const winner = poll.closed && count > 0 && count === top;
          return (
            <button
              key={i}
              type="button"
              onClick={() => choose(i)}
              aria-pressed={chosen}
              aria-disabled={!canVote}
              title={count ? names[i]!.join(", ") : "Ninguém escolheu"}
              // Pill rows (radius = half the one-line height, so a wrapped answer stays a rounded box).
              className={`relative flex min-h-10 w-full items-center gap-2.5 overflow-hidden rounded-[20px] border-2 bg-panel px-3 py-1.5 text-left text-sm font-medium transition ${
                canVote ? "hover:-translate-y-px active:translate-y-px" : "cursor-default"
              } ${chosen ? "border-accent" : canVote ? "border-line hover:border-soft" : "border-line"}`}
            >
              <span
                aria-hidden
                style={{ width: `${percent}%` }}
                className={`absolute inset-y-0 left-0 transition-[width] duration-500 ease-out-expo ${chosen || winner ? "bg-accent/30" : "bg-accent/15"}`}
              />
              {canVote || chosen ? (
                <span
                  className={`relative grid size-[18px] shrink-0 place-items-center border-2 ${poll.multiple ? "rounded-[5px]" : "rounded-full"} ${
                    chosen ? "border-accent-hi bg-accent text-on-accent" : "border-soft"
                  }`}
                >
                  {chosen && <Check className="size-3" strokeWidth={3.5} />}
                </span>
              ) : null}
              <span className={`relative min-w-0 flex-1 break-words ${winner ? "font-bold" : ""}`}>{option}</span>
              <span className="relative shrink-0 font-mono text-xs text-soft tabular-nums">
                {count > 0 && `${count} · `}
                {percent}%
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-3 flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-soft">
        {votersLabel(voters)}
        {canVote && message.from === me && (
          <span className="ml-auto flex items-center gap-1 whitespace-nowrap">
            {confirming ? (
              <>
                Encerrar de vez?
                <button
                  type="button"
                  onClick={onClosePoll}
                  className="h-7 rounded-full border-2 border-[color-mix(in_srgb,var(--color-danger)_40%,var(--color-surface))] px-3 font-bold text-danger transition hover:-translate-y-px hover:border-danger hover:bg-danger hover:text-on-accent active:translate-y-px"
                >
                  Encerrar
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="h-7 rounded-full px-3 font-bold transition hover:bg-surface-hi hover:text-ink"
                >
                  Não
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="h-7 rounded-full px-3 font-bold transition hover:bg-surface-hi hover:text-ink"
              >
                Encerrar enquete
              </button>
            )}
          </span>
        )}
      </p>
    </div>
  );
}
