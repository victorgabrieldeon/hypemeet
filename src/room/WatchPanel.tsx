import { ArrowRight, FolderOpen, Square } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { Button, inputClass, Spinner } from "../components/ui";
import type { WatchAction, WatchControls } from "./watch";
import { watchTitle } from "./WatchPlayer";
import { parseYouTube } from "./youtube";

interface WatchPanelProps {
  watch: WatchControls;
  /** Called before the file is announced, so our own player already has it when the state arrives. */
  onFileChosen: (file: File) => void;
  onDone: () => void;
  onError: (text: string) => void;
}

/** Popover above the dock: start a session, swap its video or end it. */
export function WatchPanel({ watch, onFileChosen, onDone, onError }: WatchPanelProps) {
  const { party } = watch;
  const [link, setLink] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [pending, setPending] = useState<"link" | "file" | "stop" | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function run(kind: NonNullable<typeof pending>, action: WatchAction) {
    setPending(kind);
    try {
      await watch.dispatch(action);
      onDone();
    } catch {
      onError("Não deu pra falar com quem está com o vídeo. Tente de novo.");
    } finally {
      setPending(null);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const video = parseYouTube(link);
    if (!video) return setInvalid(true);
    void run("link", { type: "load", source: { kind: "youtube", videoId: video.videoId }, position: video.start });
  }

  return (
    <div
      role="dialog"
      aria-label="Assistir junto"
      className="absolute bottom-full left-1/2 z-40 mb-3 flex w-[min(23rem,calc(100vw-1.5rem))] -translate-x-1/2 animate-pop flex-col gap-3 rounded-lg bg-panel p-3 shadow-float ring-1 ring-line"
    >
      <div className="px-1 pt-1">
        <h2 className="type-link">Assistir junto</h2>
        <p className="mt-0.5 text-xs text-soft">Cada um toca o vídeo no próprio player, com play e pause pra todo mundo.</p>
      </div>

      {party && (
        <div className="flex items-center gap-2.5 rounded-md border border-line bg-surface p-3">
          <span className="size-2 shrink-0 rounded-full bg-blurple-hi shadow-[0_0_8px_rgb(139_147_255/0.9)]" />
          <p className="min-w-0 flex-1 text-sm">
            <span className="block truncate font-semibold">{watchTitle(party.state.source)}</span>
            <span className="block truncate text-xs text-soft">
              {party.state.playing ? "Tocando" : party.state.by ? `Pausado por ${party.state.by}` : "Pausado"}
            </span>
          </p>
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => void run("stop", { type: "stop" })}
            className="type-link-sm flex h-8 items-center gap-1.5 rounded-sm bg-danger/15 px-2.5 text-danger transition hover:bg-danger hover:text-ink disabled:opacity-50"
          >
            {pending === "stop" ? <Spinner className="size-3.5" /> : <Square className="size-3 fill-current" />}
            Encerrar
          </button>
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-md border border-line bg-surface p-3">
        <p className="type-label px-0.5 pt-1 text-soft">{party ? "Trocar vídeo" : "Escolher vídeo"}</p>
        <form onSubmit={submit} className="flex gap-2">
          <input
            autoFocus
            className={`${inputClass} ${invalid ? "border-danger/70" : ""}`}
            value={link}
            onChange={(e) => {
              setLink(e.target.value);
              setInvalid(false);
            }}
            placeholder="Link do YouTube"
            aria-label="Link do YouTube"
            aria-invalid={invalid}
          />
          <Button type="submit" variant="primary" square disabled={!link.trim() || pending !== null} aria-label="Assistir">
            {pending === "link" ? <Spinner className="size-5" /> : <ArrowRight className="size-5" />}
          </Button>
        </form>
        {invalid && (
          <p role="alert" className="-mt-1 px-1 text-xs text-danger">
            Isso não parece um link de vídeo do YouTube.
          </p>
        )}
        <div className="flex items-center gap-3 text-xs text-soft">
          <span className="h-px flex-1 bg-line" /> ou <span className="h-px flex-1 bg-line" />
        </div>
        <Button className="type-link-sm h-11" disabled={pending !== null} onClick={() => fileInput.current?.click()}>
          {pending === "file" ? <Spinner className="size-4" /> : <FolderOpen className="size-4" />}
          Vídeo do computador
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="video/*,.mkv,.mov,.avi"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            onFileChosen(file);
            void run("file", { type: "load", source: { kind: "file", name: file.name, size: file.size } });
          }}
        />
        <p className="px-0.5 text-xs text-soft">
          Quem for assistir abre a própria cópia do arquivo: nada é enviado, então chega em qualidade original.
        </p>
      </div>
    </div>
  );
}
