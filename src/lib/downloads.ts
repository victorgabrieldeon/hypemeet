// Desktop builds published as GitHub Releases (scripts/publish-desktop.ts uploads exactly these
// files). Version-less names, so /releases/latest/download/<file> always serves the newest build.
export const RELEASES_REPO = "victorgabrieldeon/hypemeet-releases";

export type DesktopOS = "windows" | "mac" | "linux";

export interface DesktopBuild {
  file: string;
  /** Short name in the "all builds" list. */
  label: string;
  /** Present on the builds offered up front to visitors on that OS. */
  cta?: string;
}

export interface DesktopPlatform {
  name: string;
  /** What to expect on first launch; the builds are not signed by Apple/Microsoft. */
  hint: string;
  builds: DesktopBuild[];
}

export const DESKTOP_PLATFORMS: Record<DesktopOS, DesktopPlatform> = {
  windows: {
    name: "Windows",
    hint: "Se o Windows avisar que o app é desconhecido, clique em Mais informações → Executar assim mesmo.",
    builds: [
      { file: "HypeMeet-Setup.exe", label: "Instalador", cta: "Baixar para Windows" },
      { file: "HypeMeet-portable.exe", label: "Portátil" },
    ],
  },
  mac: {
    name: "macOS",
    hint: "Arraste o HypeMeet para Aplicativos. Se o macOS bloquear na primeira vez, abra Ajustes do Sistema → Privacidade e Segurança → Abrir Mesmo Assim.",
    builds: [
      { file: "HypeMeet-mac-arm64.zip", label: "Apple Silicon", cta: "Mac com chip M1 ou mais novo" },
      { file: "HypeMeet-mac-x64.zip", label: "Intel", cta: "Mac com Intel" },
    ],
  },
  linux: {
    name: "Linux",
    hint: "Dê permissão de execução ao AppImage (chmod +x) e abra. No Debian/Ubuntu também dá pra instalar o .deb.",
    builds: [
      { file: "HypeMeet-x86_64.AppImage", label: "AppImage", cta: "Baixar para Linux" },
      { file: "HypeMeet-amd64.deb", label: ".deb" },
      { file: "HypeMeet-x64.tar.gz", label: ".tar.gz" },
    ],
  },
};

export const DESKTOP_FILES = Object.values(DESKTOP_PLATFORMS).flatMap((p) => p.builds.map((b) => b.file));

/** Also the desktop app's update feed (latest.yml, latest-linux.yml). */
export const RELEASES_URL = `https://github.com/${RELEASES_REPO}/releases/latest/download`;

export const downloadUrl = (file: string) => `${RELEASES_URL}/${file}`;

/** Update metadata electron-builder writes next to the builds; published along with them. */
export const UPDATE_FEEDS = ["latest.yml", "latest-linux.yml"];

/** The packaged app loads this same site; it has nothing to download. */
export const IS_DESKTOP_APP = /\bElectron\//.test(navigator.userAgent);

/** null on phones/tablets and unknown systems: no build to put first. */
export function detectOS(): DesktopOS | null {
  const nav = navigator as Navigator & { userAgentData?: { platform: string; mobile: boolean } };
  const ua = navigator.userAgent;
  if (nav.userAgentData?.mobile || /Android|iPhone|iPad|iPod/i.test(ua)) return null;
  const platform = nav.userAgentData?.platform || ua;
  if (/Win/i.test(platform)) return "windows";
  // iPadOS asks for desktop sites with a Mac user agent; only real Macs lack multi-touch.
  if (/Mac/i.test(platform)) return navigator.maxTouchPoints > 1 ? null : "mac";
  if (/CrOS/i.test(platform)) return null;
  if (/Linux|X11/i.test(platform)) return "linux";
  return null;
}
