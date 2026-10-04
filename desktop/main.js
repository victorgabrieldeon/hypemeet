// HypeMeet desktop: a Chromium shell around a HypeMeet server. The UI and API stay on the server;
// this process adds what a browser tab can't: a native screen picker and system-audio capture.
const { app, BrowserWindow, Menu, desktopCapturer, dialog, ipcMain, session, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const pkg = require("./package.json");

const IS_WINDOWS = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
// On Wayland the PipeWire portal is the picker: getSources() opens it and returns the chosen source.
const IS_WAYLAND = process.platform === "linux" && process.env.XDG_SESSION_TYPE === "wayland";
// Windows and macOS (14.2+, CoreAudio tap) can drop our own playout (the room's voices) from
// loopback; on Linux it echoes back.
const LOOPBACK_EXCLUDES_SELF = IS_WINDOWS || IS_MAC;
const BACKGROUND = "#07070c";
const ICON = path.join(__dirname, "icon.png");
const PAGES = path.join(__dirname, "pages");
const PAGES_URL = pathToFileURL(PAGES).href + "/";
const CONFIG_PATH = path.join(app.getPath("userData"), "config.json");
const ALLOWED_PERMISSIONS = new Set([
  "media",
  "display-capture",
  "speaker-selection",
  "clipboard-sanitized-write",
  "fullscreen",
  "notifications",
]);

/** Accepts `host`, `host:port` or a full URL; returns the origin, or null if it isn't http(s). */
function normalizeServer(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const text = raw.trim();
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

function writeConfig(patch) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ ...readConfig(), ...patch }, null, 2));
}

/** --server=… beats HYPEMEET_URL beats the saved choice beats the URL baked in at build time. */
function initialServer() {
  const flag = process.argv.find((arg) => arg.startsWith("--server="));
  return (
    normalizeServer(flag?.slice("--server=".length)) ??
    normalizeServer(process.env.HYPEMEET_URL) ??
    normalizeServer(readConfig().server) ??
    normalizeServer(pkg.hypemeetUrl)
  );
}

/** Camera/screen APIs need a secure context; plain http is only secure on loopback. */
function needsInsecureOverride(origin) {
  const { protocol, hostname } = new URL(origin);
  return protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(hostname);
}

let server = initialServer();
// Chromium reads this switch once at startup, so a later switch to such a server needs a relaunch.
const insecureOrigin = server && needsInsecureOverride(server) ? server : null;
if (insecureOrigin) app.commandLine.appendSwitch("unsafely-treat-insecure-origin-as-secure", insecureOrigin);

/**
 * Self-signed servers (`bun run dev:lan`) are trusted on first use, pinned to the exact certificate
 * the user accepted. @type {{ host: string, fingerprint: string } | null}
 */
let trustedCertificate = readConfig().trustedCertificate ?? null;
/** host → fingerprint of the last certificate Chromium rejected, offered on the setup page. */
const rejectedCertificates = new Map();

function verifyCertificate(request, callback) {
  // -3: keep Chromium's verdict; 0: accept.
  if (request.errorCode === 0) return callback(-3);
  const { fingerprint } = request.certificate;
  if (trustedCertificate?.host === request.hostname && trustedCertificate.fingerprint === fingerprint) {
    return callback(0);
  }
  rejectedCertificates.set(request.hostname, fingerprint);
  callback(-3);
}

/** @type {BrowserWindow | null} */
let mainWindow = null;
let setupError = null;

const isServerUrl = (url) => {
  if (!server || !url) return false;
  try {
    return new URL(url).origin === server;
  } catch {
    return false;
  }
};
const isOwnPage = (frame) => !!frame?.url.startsWith(PAGES_URL);

function showSetup(error = null) {
  setupError = error;
  mainWindow.setTitle("HypeMeet");
  return mainWindow.loadFile(path.join(PAGES, "setup.html"));
}

function openServer() {
  if (!server) return showSetup();
  return mainWindow.loadURL(server).catch(() => {
    // did-fail-load already swapped in the setup page with the reason.
  });
}

// ---- Screen picker -------------------------------------------------------------------------

const ownWindowIds = () => BrowserWindow.getAllWindows().map((w) => w.getMediaSourceId());

/**
 * The picker window currently open; `sources` remembers what it was shown, by id.
 * @type {{ resolve: (choice: { source: { id: string, name: string }, audio: boolean } | null) => void,
 *          window: BrowserWindow, audioRequested: boolean, sources: Map<string, string> } | null}
 */
let pending = null;

function pickSource(audioRequested) {
  return new Promise((resolve) => {
    const window = new BrowserWindow({
      parent: mainWindow,
      modal: true,
      width: 860,
      height: 620,
      minWidth: 520,
      minHeight: 400,
      title: "Compartilhar tela",
      backgroundColor: BACKGROUND,
      icon: ICON,
      autoHideMenuBar: true,
      show: false,
      webPreferences: { preload: path.join(__dirname, "preload.js") },
    });
    window.setMenu(null);
    pending = { resolve, window, audioRequested, sources: new Map() };
    window.once("ready-to-show", () => window.show());
    window.on("closed", () => {
      if (pending?.window === window) {
        pending = null;
        resolve(null);
      }
    });
    window.loadFile(path.join(PAGES, "picker.html"));
  });
}

ipcMain.handle("picker:sources", async (event) => {
  if (!isOwnPage(event.senderFrame) || !pending) return null;
  const hidden = new Set(ownWindowIds());
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 480, height: 270 },
    fetchWindowIcons: true,
  });
  const shown = sources.filter((s) => !hidden.has(s.id));
  pending.sources = new Map(shown.map((s) => [s.id, s.name]));
  return {
    audio: pending.audioRequested ? { default: LOOPBACK_EXCLUDES_SELF, excludesSelf: LOOPBACK_EXCLUDES_SELF } : null,
    sources: shown.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.id.startsWith("screen:") ? "screen" : "window",
      thumbnail: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL(),
      icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
    })),
  };
});

ipcMain.on("picker:done", (event, choice) => {
  if (!isOwnPage(event.senderFrame) || !pending) return;
  const { resolve, window, sources } = pending;
  pending = null;
  const name = typeof choice?.id === "string" ? sources.get(choice.id) : undefined;
  resolve(name === undefined ? null : { source: { id: choice.id, name }, audio: choice.audio === true });
  window.close();
});

/** Wayland: the portal picker has no audio option, so ask once it closes. Off by default: Linux loopback echoes the room. */
async function askSystemAudio() {
  if (!mainWindow) return false;
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: "question",
    title: "Compartilhar tela",
    message: "Compartilhar o áudio do sistema também?",
    detail: "Inclui o som desta chamada: quem fala vai se ouvir de volta. Use só com a sala em silêncio.",
    buttons: ["Sem áudio", "Compartilhar áudio"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  return response === 1;
}

async function handleDisplayMedia(request, callback) {
  // Denying = calling back without a source; the page gets AbortError and treats it as "closed".
  const deny = () => callback(null);
  if (!isServerUrl(request.securityOrigin) || pending) return deny();
  try {
    if (IS_WAYLAND) {
      const [source] = await desktopCapturer.getSources({ types: ["screen", "window"] });
      if (!source) return deny();
      const audio = request.audioRequested && (await askSystemAudio());
      return callback({ video: source, ...(audio ? { audio: "loopback" } : {}) });
    }
    const choice = await pickSource(request.audioRequested);
    if (!choice) return deny();
    callback({ video: choice.source, ...(request.audioRequested && choice.audio ? { audio: "loopback" } : {}) });
  } catch (error) {
    console.error("screen share failed:", error);
    deny();
  }
}

// ---- Setup page ----------------------------------------------------------------------------

ipcMain.handle("setup:state", (event) => {
  if (!isOwnPage(event.senderFrame)) return null;
  return { server, error: setupError };
});

/** Any HypeMeet API answers unknown rooms with a JSON 404; a random site won't. */
async function probe(origin) {
  const host = new URL(origin).hostname;
  // The network service caches certificate verdicts per session: a throwaway in-memory session
  // makes every probe re-verify, so a just-trusted certificate is actually re-checked.
  const probeSession = session.fromPartition(`probe-${crypto.randomUUID()}`);
  probeSession.setCertificateVerifyProc(verifyCertificate);
  try {
    const res = await probeSession.fetch(`${origin}/api/rooms/__desktop_probe__`, {
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    });
    // The window refuses cross-origin redirects, so catch them here (e.g. http → https).
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      const target = location ? new URL(location, origin).origin : "outro endereço";
      return { error: `${origin} redireciona para ${target}: confira o endereço do servidor.` };
    }
    const body = await res.json().catch(() => null);
    return body && typeof body.error === "string" ? null : { error: "Esse endereço não parece um servidor HypeMeet" };
  } catch (error) {
    const reason = error?.cause?.message ?? error?.message ?? String(error);
    const fingerprint = /ERR_CERT_/.test(reason) ? rejectedCertificates.get(host) : undefined;
    if (fingerprint) {
      return {
        error: `O certificado de ${host} não é confiável (autoassinado?). Só confie se o servidor for seu.`,
        certificate: fingerprint,
      };
    }
    return { error: `Não foi possível conectar: ${reason}` };
  }
}

ipcMain.handle("setup:connect", async (event, raw, trustFingerprint) => {
  if (!isOwnPage(event.senderFrame)) return { error: "Origem não autorizada" };
  const origin = normalizeServer(raw);
  if (!origin) return { error: "Endereço inválido. Ex.: https://meet.seudominio.com" };

  const host = new URL(origin).hostname;
  const previousTrust = trustedCertificate;
  // Only the certificate this host actually presented can be trusted, never an arbitrary one.
  if (typeof trustFingerprint === "string" && rejectedCertificates.get(host) === trustFingerprint) {
    trustedCertificate = { host, fingerprint: trustFingerprint };
  }
  const failure = await probe(origin);
  if (failure) {
    trustedCertificate = previousTrust;
    return failure;
  }

  writeConfig({ server: origin, trustedCertificate });
  // The main session may have cached a rejection of this certificate, and the insecure-origin
  // switch is startup-only: both need a fresh process.
  const trustChanged = trustedCertificate !== previousTrust;
  if (trustChanged || (needsInsecureOverride(origin) && origin !== insecureOrigin)) {
    app.relaunch({ args: process.argv.slice(1).filter((arg) => !arg.startsWith("--server=")) });
    app.exit(0);
    return { ok: true };
  }
  server = origin;
  openServer();
  return { ok: true };
});

// ---- App -----------------------------------------------------------------------------------

function buildMenu() {
  return Menu.buildFromTemplate([
    {
      label: "HypeMeet",
      submenu: [
        { label: "Trocar servidor…", click: () => showSetup() },
        { label: "Voltar ao início", accelerator: "Alt+Home", click: () => openServer() },
        { type: "separator" },
        { role: "quit", label: "Sair" },
      ],
    },
    // macOS routes Cmd+C/V/X/A/Z through the Edit menu; without it text fields lose those shortcuts.
    ...(IS_MAC ? [{ role: "editMenu", label: "Editar" }] : []),
    {
      label: "Exibir",
      submenu: [
        { role: "reload", label: "Recarregar" },
        { role: "togglefullscreen", label: "Tela cheia" },
        { type: "separator" },
        { role: "zoomIn", label: "Aumentar zoom" },
        { role: "zoomOut", label: "Diminuir zoom" },
        { role: "resetZoom", label: "Zoom padrão" },
        { type: "separator" },
        { role: "toggleDevTools", label: "Ferramentas do desenvolvedor" },
      ],
    },
  ]);
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    title: "HypeMeet",
    backgroundColor: BACKGROUND,
    icon: ICON,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      // A minimized window is still streaming screens and mixing audio: don't throttle it.
      backgroundThrottling: false,
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  const { webContents } = mainWindow;
  webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  webContents.on("will-navigate", (event, url) => {
    if (isServerUrl(url) || url.startsWith(PAGES_URL)) return;
    event.preventDefault();
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
  });
  // Server-side redirects skip will-navigate. A server that bounces elsewhere (parked domain,
  // login wall) must not get the window, its camera permissions or the screen picker.
  webContents.on("will-redirect", (event, url, _inPlace, isMainFrame) => {
    if (!isMainFrame || isServerUrl(url)) return;
    event.preventDefault();
    showSetup(`${server} redirecionou para ${new URL(url).origin}. Confira o endereço do servidor.`);
  });
  webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
    // -3 = ERR_ABORTED: a navigation replaced this one, not a failure.
    if (!isMainFrame || code === -3 || !isServerUrl(url)) return;
    showSetup(`Não foi possível abrir ${server} (${description})`);
  });

  openServer();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    const ses = session.defaultSession;
    ses.setPermissionRequestHandler((_wc, permission, callback, details) =>
      callback(ALLOWED_PERMISSIONS.has(permission) && isServerUrl(details.requestingUrl)),
    );
    ses.setPermissionCheckHandler((_wc, permission, origin) => ALLOWED_PERMISSIONS.has(permission) && isServerUrl(origin));
    ses.setDisplayMediaRequestHandler(handleDisplayMedia);
    ses.setCertificateVerifyProc(verifyCertificate);

    Menu.setApplicationMenu(buildMenu());
    createMainWindow();
  });

  app.on("window-all-closed", () => app.quit());
}
