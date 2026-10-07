import { Check, Plus, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { MAX_OPTION, MAX_POLL_OPTIONS, MAX_QUESTION, MIN_POLL_OPTIONS, type ChatMessage } from "./chat";

const fieldClass =
  "h-10 w-full min-w-0 rounded-sm border border-transparent bg-surface-hi px-3 text-sm text-ink outline-none transition placeholder:text-soft/70 focus:border-blurple/70";

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
                className="grid size-9 shrink-0 place-items-center rounded-sm text-soft transition hover:bg-surface-hi hover:text-ink"
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
            className="flex h-9 items-center gap-1.5 self-start rounded-sm px-2 text-sm text-blurple-hi transition hover:bg-surface-hi"
          >
            <Plus className="size-4" /> Adicionar resposta
          </button>
        )}
        {duplicate && <p className="text-xs text-warn">Tem resposta repetida.</p>}
      </fieldset>

      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={multiple}
          onChange={(e) => setMultiple(e.target.checked)}
          className="size-4 accent-blurple"
        />
        Permitir mais de uma resposta
      </label>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="type-link-sm h-9 rounded-sm px-4 text-soft transition hover:bg-surface-hi hover:text-ink"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={!ready}
          className="type-link-sm h-9 rounded-sm bg-blurple px-4 text-ink transition hover:brightness-110 disabled:opacity-50 disabled:hover:brightness-100"
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
    <div className="mt-1.5 w-full rounded-md border border-line bg-surface p-3 whitespace-normal">
      <p className="font-display font-bold">{message.text}</p>
      <p className="mt-0.5 text-xs text-soft">
        {poll.closed ? "Enquete encerrada" : poll.multiple ? "Escolha uma ou mais respostas" : "Escolha uma resposta"}
      </p>
      <div role="group" aria-label={message.text} className="mt-2.5 flex flex-col gap-1.5">
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
              className={`relative flex min-h-10 w-full items-center gap-2.5 overflow-hidden rounded-sm bg-surface-hi px-3 py-2 text-left text-sm transition ${
                canVote ? "hover:ring-1 hover:ring-white/15" : "cursor-default"
              } ${chosen ? "ring-1 ring-blurple hover:ring-blurple" : ""}`}
            >
              <span
                aria-hidden
                style={{ width: `${percent}%` }}
                className={`absolute inset-y-0 left-0 transition-[width] duration-500 ease-out-expo ${chosen || winner ? "bg-blurple/35" : "bg-white/[0.07]"}`}
              />
              {canVote || chosen ? (
                <span
                  className={`relative grid size-[18px] shrink-0 place-items-center border-2 ${poll.multiple ? "rounded-[5px]" : "rounded-full"} ${
                    chosen ? "border-blurple bg-blurple" : "border-soft/60"
                  }`}
                >
                  {chosen && <Check className="size-3" strokeWidth={3.5} />}
                </span>
              ) : null}
              <span className={`relative min-w-0 flex-1 break-words ${winner ? "font-semibold" : ""}`}>{option}</span>
              <span className="relative shrink-0 text-xs text-soft tabular-nums">
                {count > 0 && `${count} · `}
                {percent}%
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-2.5 flex items-center gap-2 text-xs text-soft">
        {votersLabel(voters)}
        {canVote && message.from === me && (
          <span className="ml-auto flex items-center gap-3">
            {confirming ? (
              <>
                Encerrar de vez?
                <button type="button" onClick={onClosePoll} className="font-medium text-danger transition hover:brightness-125">
                  Encerrar
                </button>
                <button type="button" onClick={() => setConfirming(false)} className="font-medium transition hover:text-ink">
                  Não
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirming(true)} className="font-medium transition hover:text-ink">
                Encerrar enquete
              </button>
            )}
          </span>
        )}
      </p>
    </div>
  );
}
