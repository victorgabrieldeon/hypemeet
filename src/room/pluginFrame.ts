import type { PluginInfo } from "../lib/api";

/** What a plugin's iframe may use: games want controllers, sound without a click first, and full screen. */
export const PLUGIN_FRAME_ALLOW = "clipboard-read; clipboard-write; gamepad; autoplay; fullscreen";

/**
 * A plugin's own origin keeps it away from the room's; one on the room's origin (built in, or through Discord's
 * proxy) runs as an opaque one instead, without allow-same-origin.
 */
export const pluginSandbox = (opaque: boolean) =>
  `allow-scripts ${opaque ? "" : "allow-same-origin "}allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads`;

/**
 * The plugins this page can show. External ones on the room's own origin are dropped (the sandbox wouldn't hold
 * them); in Discord they go through `reach` (its URL mappings). Built-in ones are served by this site: their
 * addresses are made absolute here, and they need neither check.
 */
export async function usablePlugins(
  list: PluginInfo[],
  origin: string,
  discord: boolean,
  reach: (info: PluginInfo) => Promise<PluginInfo | null>,
): Promise<PluginInfo[]> {
  const out = await Promise.all(
    list.map(async (p): Promise<PluginInfo | null> => {
      if (p.builtin) return { ...p, url: new URL(p.url, origin).href, icon: p.icon && new URL(p.icon, origin).href };
      if (new URL(p.url).origin === origin) return null;
      return discord ? reach(p) : p;
    }),
  );
  return out.filter((p) => p !== null);
}
