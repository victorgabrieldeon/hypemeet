import { ChartBarBig, ImageOff, ImagePlus, SendHorizontal, X } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Avatar, cardClass, Spinner } from "../components/ui";
import { personStyle } from "../lib/color";
import { MAX_TEXT, prepareImage, type ChatMessage, type ChatState, type RoomChat } from "./chat";
import { PollCard, PollComposer } from "./Poll";

/** Consecutive messages from the same person within this window share one name/avatar header. */
const GROUP_MS = 5 * 60_000;

const URL_RE = /\bhttps?:\/\/[^\s<>"]+/g;

/** Plain text with http(s) URLs turned into links; trailing punctuation stays out of the link. */
function Linkified({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    let url = match[0].replace(/[.,;:!?'"]+$/, "");
    // Keep a closing paren only when the URL opened one, e.g. Wikipedia's "Foo_(bar)".
    while (url.endsWith(")") && url.split("(").length < url.split(")").length) url = url.slice(0, -1);
    parts.push(text.slice(last, match.index));
    parts.push(
      <a
        key={match.index}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="font-bold text-accent-hi underline decoration-[1.5px] underline-offset-3 transition hover:text-ink"
      >
        {url}
      </a>,
    );
    last = match.index + url.length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

const formatTime = (time: number) => new Date(time).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

function MessageImage({ image, onOpen, onLoad }: { image: ChatMessage["image"]; onOpen: (url: string) => void; onLoad: () => void }) {
  if (image === "loading")
    return (
      <div className="grid h-32 w-48 place-items-center rounded-md border-2 border-line bg-surface text-soft">
        <Spinner className="size-5" />
      </div>
    );
  if (image === "lost" || !image)
    return (
      <p className="flex items-center gap-1.5 text-xs font-medium text-soft">
        <ImageOff className="size-3.5" /> A imagem não chegou
      </p>
    );
  return (
    <button type="button" onClick={() => onOpen(image.url)} className="block max-w-full" title="Ampliar">
      <img
        src={image.url}
        alt="Imagem enviada no chat"
        onLoad={onLoad}
        className="max-h-60 max-w-full rounded-md border-2 border-line object-contain transition hover:brightness-110"
      />
    </button>
  );
}

interface ChatPanelProps {
  chat: RoomChat;
  state: ChatState;
  open: boolean;
  onClose: () => void;
  onError: (text: string) => void;
}

/** Side panel next to the stage (full overlay on narrow screens). Stays mounted while closed to keep the draft. */
export function ChatPanel({ chat, state, open, onClose, onError }: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<{ blob: Blob; url: string } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const [writingPoll, setWritingPoll] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** Follow new messages only while the reader is at the bottom. */
  const stick = useRef(true);
  const { messages } = state;

  const toBottom = () => {
    const list = listRef.current;
    if (list && stick.current) list.scrollTop = list.scrollHeight;
  };

  useLayoutEffect(toBottom, [messages, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => () => void (pending && URL.revokeObjectURL(pending.url)), [pending]);

  useEffect(() => {
    if (!viewing) return;
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && setViewing(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [viewing]);

  async function attach(file: File | undefined) {
    if (!file) return;
    setPreparing(true);
    try {
      const blob = await prepareImage(file);
      setPending({ blob, url: URL.createObjectURL(blob) });
      inputRef.current?.focus();
    } catch (err) {
      onError((err as Error).message || "Não deu pra abrir essa imagem.");
    } finally {
      setPreparing(false);
    }
  }

  function send() {
    const text = draft.trim();
    if (!text && !pending) return;
    stick.current = true;
    void chat.send(text, pending?.blob);
    setDraft("");
    setPending(null);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  }

  function onPaste(e: ClipboardEvent) {
    const file = [...e.clipboardData.files].find((f) => f.type.startsWith("image/"));
    if (!file) return;
    // Copying an image from a page also puts its HTML on the clipboard; don't paste that as text.
    e.preventDefault();
    void attach(file);
  }

  function onDrop(e: DragEvent) {
    const file = [...e.dataTransfer.files].find((f) => f.type.startsWith("image/"));
    if (!file) return;
    e.preventDefault();
    void attach(file);
  }

  return (
    <aside
      aria-label="Chat da sala"
      onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
      onDrop={onDrop}
      className={`absolute inset-0 z-30 flex-col overflow-hidden ${cardClass} md:static md:w-[22rem] md:shrink-0 xl:w-[26rem] ${open ? "flex animate-fade-in" : "hidden"}`}
    >
      <header className="flex h-[68px] shrink-0 items-center justify-between gap-2 border-b-[1.5px] border-surface-hi pr-3.5 pl-5">
        <h2 className="type-heading-sm">Chat</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar chat"
          title="Fechar chat"
          className="grid size-10 place-items-center rounded-full text-soft transition hover:-translate-y-px hover:bg-surface hover:text-ink active:translate-y-px"
        >
          <X className="size-5" />
        </button>
      </header>

      <div
        ref={listRef}
        onScroll={(e) => {
          const list = e.currentTarget;
          stick.current = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
        }}
        className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4 [mask-image:linear-gradient(to_bottom,transparent,black_1rem)]"
      >
        {/* With messages, it and they sit at the bottom like a conversation; an auto margin, not justify-end, keeps the top scrollable. */}
        <p className={`mx-auto mb-4 max-w-64 text-center text-xs font-medium text-soft ${messages.length ? "mt-auto" : ""}`}>
          As mensagens vão direto pra quem está na sala e somem quando todo mundo sair.
        </p>
        {messages.length === 0 && (
          <p className="m-auto max-w-64 text-center text-sm font-medium text-soft">Ninguém falou nada ainda. Cola um link, uma imagem, faz uma enquete…</p>
        )}
        {messages.map((message, i) => {
          const prev = messages[i - 1];
          const grouped = prev?.from === message.from && message.time - prev.time < GROUP_MS;
          const mine = message.from === chat.identity;
          const body = (
            <div className={`flex w-full min-w-0 flex-col gap-1.5 ${mine ? "items-end" : "items-start"}`}>
              {/* Dim only the message: the "Não enviada" label below has to keep its contrast. */}
              <div className={`flex w-full min-w-0 flex-col gap-1.5 ${mine ? "items-end" : "items-start"} ${message.failed ? "opacity-60" : ""}`}>
                {message.poll ? (
                  <PollCard
                    message={{ ...message, poll: message.poll }}
                    me={chat.identity}
                    onVote={(choices) => chat.vote(message.id, choices)}
                    onClosePoll={() => chat.closePoll(message.id)}
                  />
                ) : (
                  message.text && (
                    // Neutral, with a breath of the sender's colour; ours is grape.
                    <p
                      className={`max-w-[calc(100%-1.5rem)] border px-3.5 py-2.5 text-[15px] leading-[1.4] font-medium wrap-anywhere whitespace-pre-wrap text-ink ${
                        mine
                          ? "rounded-[16px_16px_6px_16px] border-[color-mix(in_srgb,var(--color-accent)_50%,var(--color-surface))] bg-[color-mix(in_srgb,var(--color-accent)_28%,var(--color-surface))]"
                          : "rounded-[16px_16px_16px_6px] border-[color-mix(in_srgb,var(--p)_30%,var(--color-surface))] bg-[color-mix(in_srgb,var(--p)_4%,var(--color-surface))]"
                      }`}
                    >
                      <Linkified text={message.text} />
                    </p>
                  )
                )}
                {message.image && <MessageImage image={message.image} onOpen={setViewing} onLoad={toBottom} />}
              </div>
              {message.failed && <p className="px-0.5 text-xs font-bold text-danger">Não enviada</p>}
            </div>
          );
          return grouped ? (
            <div key={message.id} style={personStyle(message.from)} className={`mt-1.5 ${mine ? "pr-12" : "pl-12"}`}>
              {body}
            </div>
          ) : (
            <div
              key={message.id}
              style={personStyle(message.from)}
              className={`flex items-start gap-3 ${mine ? "flex-row-reverse" : ""} ${i > 0 ? "mt-4" : ""}`}
            >
              <Avatar name={message.name} seed={message.from} size="sm" />
              <div className={`flex min-w-0 flex-1 flex-col ${mine ? "items-end" : "items-start"}`}>
                <p className="mb-1.5 flex max-w-full items-baseline gap-2 px-0.5">
                  <span className="truncate font-display text-sm font-extrabold text-(--p)">{message.name}</span>
                  <span className="shrink-0 text-xs font-medium text-soft">{formatTime(message.time)}</span>
                </p>
                {body}
              </div>
            </div>
          );
        })}
      </div>

      <div className="px-3.5 pt-1 pb-3.5">
        {writingPoll ? (
          <PollComposer
            onCreate={(question, options, multiple) => {
              stick.current = true;
              void chat.sendPoll(question, options, multiple);
              setWritingPoll(false);
            }}
            onCancel={() => {
              setWritingPoll(false);
              inputRef.current?.focus();
            }}
          />
        ) : (
          <>
            {(pending || preparing) && (
              <div className="relative mb-2 inline-block">
                {pending ? (
                  <img src={pending.url} alt="Imagem a enviar" className="max-h-28 rounded-md border-2 border-line" />
                ) : (
                  <div className="grid size-20 place-items-center rounded-md border-2 border-line bg-surface text-soft">
                    <Spinner className="size-5" />
                  </div>
                )}
                {pending && (
                  <button
                    type="button"
                    onClick={() => setPending(null)}
                    aria-label="Remover imagem"
                    className="absolute -top-2 -right-2 grid size-6 place-items-center rounded-full border-2 border-panel bg-surface-hi text-ink transition hover:bg-danger hover:text-on-accent"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            )}
            {/* Half the one-line height as radius: a pill that stays a rounded box as the text grows. */}
            <div className="flex items-end gap-1 rounded-[28px] border-2 border-line bg-surface py-1.5 pr-1.5 pl-4 transition has-[textarea:focus]:border-accent">
              <textarea
                ref={inputRef}
                rows={1}
                value={draft}
                maxLength={MAX_TEXT}
                placeholder="Mensagem"
                aria-label="Mensagem"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                className="field-sizing-content max-h-32 min-h-10 min-w-0 flex-1 resize-none bg-transparent py-2 pr-1 text-[15px] font-medium text-ink outline-none placeholder:text-soft"
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                aria-label="Enviar imagem"
                title="Enviar imagem (ou cole/arraste aqui)"
                className="grid size-10 shrink-0 place-items-center rounded-full text-soft transition hover:-translate-y-px hover:bg-surface-hi hover:text-ink active:translate-y-px"
              >
                <ImagePlus className="size-5" />
              </button>
              <button
                type="button"
                onClick={() => setWritingPoll(true)}
                aria-label="Criar enquete"
                title="Criar enquete"
                className="grid size-10 shrink-0 place-items-center rounded-full text-soft transition hover:-translate-y-px hover:bg-surface-hi hover:text-ink active:translate-y-px"
              >
                <ChartBarBig className="size-5" />
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  void attach(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={send}
                disabled={!draft.trim() && !pending}
                aria-label="Enviar"
                title="Enviar (Enter)"
                className="grid size-10 shrink-0 place-items-center rounded-full border-2 border-accent-hi bg-accent text-on-accent transition hover:-translate-y-px hover:bg-accent-hi active:translate-y-px disabled:translate-y-0 disabled:border-line disabled:bg-surface-hi disabled:text-soft"
              >
                <SendHorizontal className="size-[18px]" />
              </button>
            </div>
          </>
        )}
      </div>

      {viewing &&
        createPortal(
          <div className="fixed inset-0 z-50 grid animate-fade-in place-items-center bg-black/80 p-4" onClick={() => setViewing(null)}>
            <img src={viewing} alt="Imagem ampliada" className="max-h-[92vh] max-w-[94vw] rounded-md object-contain shadow-float" />
          </div>,
          document.body,
        )}
    </aside>
  );
}
