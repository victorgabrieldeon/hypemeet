import { ImageOff, ImagePlus, SendHorizontal, X } from "lucide-react";
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
import { Avatar, Spinner } from "../components/ui";
import { MAX_TEXT, prepareImage, type ChatMessage, type ChatState, type RoomChat } from "./chat";

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
        className="text-blurple-hi underline decoration-blurple-hi/40 underline-offset-2 hover:decoration-blurple-hi"
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
      <div className="mt-1 grid h-32 w-48 place-items-center rounded-md bg-surface text-soft">
        <Spinner className="size-5" />
      </div>
    );
  if (image === "lost" || !image)
    return (
      <p className="mt-1 flex items-center gap-1.5 text-xs text-soft">
        <ImageOff className="size-3.5" /> A imagem não chegou
      </p>
    );
  return (
    <button type="button" onClick={() => onOpen(image.url)} className="mt-1 block max-w-full" title="Ampliar">
      <img
        src={image.url}
        alt="Imagem enviada no chat"
        onLoad={onLoad}
        className="max-h-60 max-w-full rounded-md object-contain transition hover:brightness-110"
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
      className={`absolute inset-0 z-30 flex-col overflow-hidden rounded-lg border border-line bg-panel md:static md:w-[22rem] md:shrink-0 ${open ? "flex animate-fade-in" : "hidden"}`}
    >
      <header className="flex items-center justify-between gap-2 border-b border-line py-2 pr-2 pl-4">
        <h2 className="type-link">Chat</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar chat"
          title="Fechar chat"
          className="grid size-9 place-items-center rounded-sm text-soft transition hover:bg-surface-hi hover:text-ink"
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
        className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-3"
      >
        <p className="mx-auto mb-3 max-w-60 text-center text-xs text-soft">
          As mensagens vão direto pra quem está na sala e somem quando todo mundo sair.
        </p>
        {messages.length === 0 && (
          <p className="m-auto text-center text-sm text-soft">Ninguém falou nada ainda. Cola um link, uma imagem…</p>
        )}
        {messages.map((message, i) => {
          const prev = messages[i - 1];
          const grouped = prev?.from === message.from && message.time - prev.time < GROUP_MS;
          const body = (
            <div className={`min-w-0 text-[15px] leading-snug break-words whitespace-pre-wrap ${message.failed ? "opacity-60" : ""}`}>
              {message.text && <Linkified text={message.text} />}
              {message.image && <MessageImage image={message.image} onOpen={setViewing} onLoad={toBottom} />}
              {message.failed && <p className="mt-0.5 text-xs text-danger">Não enviada</p>}
            </div>
          );
          return grouped ? (
            <div key={message.id} className="mt-1 pl-12">
              {body}
            </div>
          ) : (
            <div key={message.id} className={`flex gap-3 ${i > 0 ? "mt-4" : ""}`}>
              <Avatar name={message.name} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="flex items-baseline gap-2">
                  <span className="truncate text-sm font-semibold">{message.name}</span>
                  <span className="shrink-0 text-xs text-soft">{formatTime(message.time)}</span>
                </p>
                {body}
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-line p-3">
        {(pending || preparing) && (
          <div className="relative mb-2 inline-block">
            {pending ? (
              <img src={pending.url} alt="Imagem a enviar" className="max-h-28 rounded-md ring-1 ring-line" />
            ) : (
              <div className="grid size-20 place-items-center rounded-md bg-surface text-soft">
                <Spinner className="size-5" />
              </div>
            )}
            {pending && (
              <button
                type="button"
                onClick={() => setPending(null)}
                aria-label="Remover imagem"
                className="absolute -top-2 -right-2 grid size-6 place-items-center rounded-full bg-surface-hi text-ink ring-2 ring-panel transition hover:bg-danger"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        )}
        <div className="flex items-end gap-1.5 rounded-md bg-surface-hi p-1.5 transition focus-within:shadow-[0_0_0_4px_rgb(88_101_242/0.15)]">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            aria-label="Enviar imagem"
            title="Enviar imagem (ou cole/arraste aqui)"
            className="grid size-9 shrink-0 place-items-center rounded-sm text-soft transition hover:bg-surface hover:text-ink"
          >
            <ImagePlus className="size-5" />
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
            className="field-sizing-content max-h-32 min-h-9 min-w-0 flex-1 resize-none bg-transparent px-1 py-1.5 text-[15px] text-ink outline-none placeholder:text-soft/70"
          />
          <button
            type="button"
            onClick={send}
            disabled={!draft.trim() && !pending}
            aria-label="Enviar"
            title="Enviar (Enter)"
            className="grid size-9 shrink-0 place-items-center rounded-sm bg-blurple text-ink transition hover:brightness-110 disabled:bg-transparent disabled:text-soft/50"
          >
            <SendHorizontal className="size-5" />
          </button>
        </div>
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
