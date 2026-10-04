import { Download, RefreshCw } from "lucide-react";
import { useAppUpdate } from "../lib/updates";
import { Spinner, headerLinkClass } from "./ui";

/** Top-bar update control of the desktop app; renders nothing until there's a new version. */
export function UpdateButton() {
  const { state, apply } = useAppUpdate();
  if (!state) return null;

  if (state.status === "downloading") {
    return (
      <span className={`${headerLinkClass} pointer-events-none`} role="status" title={`Baixando a versão ${state.version}`}>
        <Spinner className="size-4" />
        <span className="hidden sm:inline">Baixando atualização</span>
        <span className="tabular-nums">{state.percent}%</span>
      </span>
    );
  }

  if (state.status === "ready" || (state.status === "available" && state.mode === "manual")) {
    const ready = state.status === "ready";
    const Icon = ready ? RefreshCw : Download;
    return (
      <button
        type="button"
        onClick={apply}
        title={ready ? `Reinicia o app na versão ${state.version}` : `Baixa a versão ${state.version} no navegador`}
        className={`${headerLinkClass} animate-fade-in border-blurple/60 bg-blurple/15 text-ink hover:bg-blurple/25`}
      >
        <Icon className="size-4" />
        <span>{ready ? "Atualizar" : "Baixar atualização"}</span>
        <span className="hidden text-soft sm:inline">v{state.version}</span>
      </button>
    );
  }

  return null;
}
