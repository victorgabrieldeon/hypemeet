// In-app updates. Builds electron-updater can replace in place (Windows installer, AppImage, .deb)
// download in the background and restart into the new version on "Atualizar"; the rest (macOS
// with its ad-hoc signature, portable .exe, .tar.gz) only learn there's a new version and open its
// download in the browser. Releases come from scripts/publish-desktop.ts; the build script bakes
// their URL into package.json as `releasesUrl`.
const { app, dialog, net, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const pkg = require("./package.json");

const CHECK_EVERY = 4 * 60 * 60 * 1000;
const FIRST_CHECK_AFTER = 10 * 1000;
/** electron-builder names the .deb package after package.json `name`. */
const DPKG_LIST = `/var/lib/dpkg/info/${pkg.name}.list`;

/**
 * @typedef {{ status: "idle" } | { status: "checking" } | { status: "latest" }
 *   | { status: "available", version: string }
 *   | { status: "downloading", version: string, percent: number }
 *   | { status: "ready", version: string }
 *   | { status: "error", message: string }} UpdateStatus
 * @typedef {UpdateStatus & { current: string, mode: "auto" | "manual" | null }} UpdateState
 */

/** The .deb and the .tar.gz share their resources/, package-type included: ask dpkg who owns us. */
function installedByDpkg() {
  try {
    return fs.readFileSync(DPKG_LIST, "utf8").split("\n").includes(process.execPath);
  } catch {
    return false;
  }
}

/** auto: electron-updater installs it. manual: we point at the download. null: no updates (dev). */
function detectMode() {
  if (!app.isPackaged || !pkg.releasesUrl) return null;
  if (process.platform === "win32") return process.env.PORTABLE_EXECUTABLE_FILE ? "manual" : "auto";
  if (process.platform === "linux") return process.env.APPIMAGE || installedByDpkg() ? "auto" : "manual";
  return "manual";
}

/** The published file a manual update downloads (names from src/lib/downloads.ts). */
function manualDownload() {
  if (process.platform === "darwin") return `HypeMeet-mac-${process.arch === "arm64" ? "arm64" : "x64"}.zip`;
  if (process.platform === "win32") return "HypeMeet-portable.exe";
  return "HypeMeet-x64.tar.gz";
}

/** Numeric x.y.z comparison; prerelease tags aren't published. */
function isNewer(candidate, current) {
  const a = candidate.split(/[.-]/).map(Number);
  const b = current.split(/[.-]/).map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

const errorMessage = (error) => (error?.message ?? String(error)).split("\n")[0];

/**
 * @param {{ getWindow: () => import("electron").BrowserWindow | null, broadcast: (state: UpdateState) => void }} options
 */
function createUpdater({ getWindow, broadcast }) {
  const mode = detectMode();
  /** @type {UpdateStatus} */
  let status = { status: "idle" };
  /** @type {import("electron-updater").AppUpdater | null} */
  let updater = null;

  const state = () => ({ ...status, current: app.getVersion(), mode });
  function set(next) {
    status = next;
    broadcast(state());
  }

  if (mode === "auto") {
    updater = require("electron-updater").autoUpdater;
    updater.setFeedURL({ provider: "generic", url: pkg.releasesUrl });
    updater.autoDownload = true;
    // Closing the app installs a downloaded update too; a .deb would ask for the password on quit.
    updater.autoInstallOnAppQuit = process.platform !== "linux" || !!process.env.APPIMAGE;
    // Published files drop the version from their names, so old and new blockmap URLs collide.
    updater.disableDifferentialDownload = true;
    updater.on("checking-for-update", () => {
      if (status.status !== "downloading" && status.status !== "ready") set({ status: "checking" });
    });
    updater.on("update-not-available", () => set({ status: "latest" }));
    updater.on("update-available", (info) => set({ status: "downloading", version: info.version, percent: 0 }));
    updater.on("download-progress", (progress) => {
      if (status.status === "downloading") set({ ...status, percent: Math.round(progress.percent) });
    });
    updater.on("update-downloaded", (info) => set({ status: "ready", version: info.version }));
    updater.on("error", (error) => {
      console.error("update failed:", error);
      set({ status: "error", message: errorMessage(error) });
    });
  }

  async function checkManual() {
    set({ status: "checking" });
    try {
      // Every platform's metadata carries the same version; latest.yml is the Windows one.
      const res = await net.fetch(`${pkg.releasesUrl}/latest.yml`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const version = /^version:\s*['"]?([^'"\s]+)/m.exec(await res.text())?.[1];
      if (!version) throw new Error("versão não encontrada");
      set(isNewer(version, app.getVersion()) ? { status: "available", version } : { status: "latest" });
    } catch (error) {
      console.error("update check failed:", error);
      set({ status: "error", message: errorMessage(error) });
    }
  }

  /** Resolves once the check settles; a downloaded update is never checked over. */
  async function check() {
    if (!mode || status.status === "checking" || status.status === "downloading" || status.status === "ready") return;
    if (mode === "manual") return checkManual();
    // Failures also arrive through the "error" event.
    await updater.checkForUpdates().catch(() => {});
  }

  /** "Atualizar": restart into the downloaded version, or open the manual download. */
  function apply() {
    if (status.status === "ready") {
      // Silent installer, then relaunch the app.
      setImmediate(() => updater.quitAndInstall(true, true));
    } else if (status.status === "available" && mode === "manual") {
      shell.openExternal(`${pkg.releasesUrl}/${manualDownload()}`);
    }
  }

  /** Menu → "Verificar atualizações…": the same check, with a dialog for every outcome. */
  async function checkFromMenu() {
    const window = getWindow();
    const show = (options) =>
      window ? dialog.showMessageBox(window, { title: "Atualizações", noLink: true, ...options }) : dialog.showMessageBox(options);
    if (!mode) {
      return show({ type: "info", message: "Atualizações só funcionam no app instalado.", detail: `Versão ${app.getVersion()}` });
    }
    await check();
    switch (status.status) {
      case "latest":
        return show({ type: "info", message: "O HypeMeet está atualizado.", detail: `Versão ${app.getVersion()}` });
      case "error":
        return show({ type: "error", message: "Não foi possível verificar atualizações.", detail: status.message });
      case "downloading":
        return show({
          type: "info",
          message: `Baixando a versão ${status.version}…`,
          detail: "Quando terminar, o botão Atualizar aparece na tela inicial. Ela também é instalada quando você fechar o app.",
        });
      case "ready": {
        const { response } = await show({
          type: "question",
          message: `A versão ${status.version} está pronta.`,
          detail: "O HypeMeet vai fechar e abrir de novo, saindo da sala se você estiver em uma.",
          buttons: ["Depois", "Reiniciar e atualizar"],
          defaultId: 1,
          cancelId: 0,
        });
        if (response === 1) apply();
        return;
      }
      case "available": {
        const { response } = await show({
          type: "question",
          message: `A versão ${status.version} está disponível.`,
          detail: `Você tem a ${app.getVersion()}. Baixe a nova e substitua o app atual.`,
          buttons: ["Depois", "Baixar"],
          defaultId: 1,
          cancelId: 0,
        });
        if (response === 1) apply();
        return;
      }
    }
  }

  function start() {
    if (!mode) return;
    setTimeout(check, FIRST_CHECK_AFTER);
    setInterval(check, CHECK_EVERY);
  }

  return { state, check, apply, checkFromMenu, start };
}

module.exports = { createUpdater };
