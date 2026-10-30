/**
 * Plugins (see sdk/hypemeet-plugin.ts): pages on their own origin, listed by base URL in env PLUGINS.
 * Their manifests are read from `<base>/hypemeet-plugin.json` and re-read every few minutes.
 */

export interface PluginInfo {
  id: string;
  name: string;
  description: string;
  icon: string | null;
  /** Page the room embeds. */
  url: string;
  /** Served by HypeMeet itself (server/bt3/): its url is on the site's own origin, and opening it takes a pass. */
  builtin?: true;
}

const MANIFEST = "hypemeet-plugin.json";
const REFRESH_MS = 5 * 60_000;
/** While some plugin has never answered, it's tried again sooner. */
const RETRY_MS = 30_000;

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Same origin as the plugin's base, so a manifest can't point the room's iframe somewhere else. */
function sameOriginUrl(value: unknown, base: URL): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value, base);
    return url.origin === base.origin ? url.href : null;
  } catch {
    return null;
  }
}

export function parseManifest(raw: unknown, base: URL): PluginInfo | null {
  const m = (raw ?? {}) as Record<string, unknown>;
  const id = typeof m.id === "string" && /^[a-z0-9-]{1,32}$/.test(m.id) ? m.id : null;
  const name = text(m.name, 40);
  const url = sameOriginUrl(m.entry ?? base.href, base);
  if (!id || !name || !url) return null;
  return { id, name, description: text(m.description, 200), icon: sameOriginUrl(m.icon, base), url };
}

export function createPlugins(bases: string[]) {
  const urls = bases.flatMap((b) => {
    try {
      return [new URL(b.endsWith("/") ? b : `${b}/`)];
    } catch {
      console.error(`PLUGINS: ignoring invalid URL ${b}`);
      return [];
    }
  });
  // Last good manifest per base: a plugin that's briefly down keeps its place in the list.
  const known = new Map<string, PluginInfo>();
  let fetchedAt = 0;
  let refreshing: Promise<void> | null = null;

  async function refresh() {
    await Promise.all(
      urls.map(async (base) => {
        try {
          const res = await fetch(new URL(MANIFEST, base), { signal: AbortSignal.timeout(5000) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const info = parseManifest(await res.json(), base);
          if (!info) throw new Error("invalid manifest");
          known.set(base.href, info);
        } catch (err) {
          console.error(`plugin ${base.href}: ${(err as Error).message}`);
        }
      }),
    );
    fetchedAt = Date.now();
  }

  return {
    configured: urls.length > 0,
    async list(): Promise<PluginInfo[]> {
      if (!urls.length) return [];
      if (Date.now() - fetchedAt > (known.size < urls.length ? RETRY_MS : REFRESH_MS))
        await (refreshing ??= refresh().finally(() => (refreshing = null)));
      // Two bases claiming one id: the first listed wins.
      const byId = new Map<string, PluginInfo>();
      for (const base of urls) {
        const info = known.get(base.href);
        if (info && !byId.has(info.id)) byId.set(info.id, info);
      }
      return [...byId.values()];
    },
  };
}
