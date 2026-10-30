/**
 * The game's page and net.js, adjusted to live under a path: HypeMeet serves it at /plugins/bt3/p/<pass>/game/
 * (and, in Discord, under <app>.discordsays.com), where the fork's absolute addresses (/disc, /net/ws...) would
 * miss. Each swap must find its text exactly: a change in the fork fails the build here, loudly, instead of
 * shipping a game that can't find its disc.
 */

interface Swap {
  from: string;
  to: string;
}

/** Ahead of </body>: F1 (the game's settings), Tab and Esc stay in the game instead of doing the browser's thing. */
const KEYS = `<script>
  // HypeMeet: with the game focused, F1 (its settings), Tab and Esc are the game's, not the browser's.
  document.getElementById('canvas').addEventListener('keydown', (e) => {
    if (e.key === 'F1' || e.key === 'Tab' || e.key === 'Escape') e.preventDefault();
  });
</script>
</body>`;

const SHELL: Swap[] = [
  { from: "pieceDisc('/disc')", to: "pieceDisc('disc')" },
  { from: "Q.get('disc') || '/disc.iso'", to: "Q.get('disc') || 'disc.iso'" },
  { from: "fetch('/telemetry'", to: "fetch('telemetry'" },
];

const WS = "${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/";
const NET: Swap[] = [
  {
    from: "'use strict';",
    to: "'use strict';\n  // (HypeMeet: the game lives under a path) a WebSocket address next to this page\n  const netUrl = (path) => new URL(path, location.href).href.replace(/^http/, 'ws');",
  },
  { from: `\`${WS}net/ws?room=`, to: "`${netUrl('net/ws')}?room=" },
  { from: `\`${WS}net/queue?name=`, to: "`${netUrl('net/queue')}?name=" },
  { from: "fetch('/net/stat'", to: "fetch('net/stat'" },
];

/** Absolute addresses that must be gone afterwards. */
const LEFTOVERS = [/['"`]\/(disc|telemetry|net\/)/, /location\.host\}\//];

function apply(name: string, source: string, swaps: Swap[]): string {
  let out = source;
  for (const { from, to } of swaps) {
    const at = out.indexOf(from);
    if (at < 0) throw new Error(`${name}: não achei o trecho ${JSON.stringify(from)} (o jogo mudou? revise plugins/bt3/builder/patch.ts)`);
    out = out.split(from).join(to);
  }
  return out;
}

function check(name: string, out: string) {
  for (const re of LEFTOVERS) {
    const m = re.exec(out);
    if (m) throw new Error(`${name}: sobrou um caminho absoluto: ${JSON.stringify(m[0])}`);
  }
  return out;
}

export function patchShell(html: string): string {
  const out = apply("index.html", html, SHELL);
  const end = out.lastIndexOf("</body>");
  if (end < 0) throw new Error("index.html: não achei o </body>");
  return check("index.html", out.slice(0, end) + KEYS + out.slice(end + "</body>".length));
}

export function patchNet(js: string): string {
  // Only the first 'use strict' gets netUrl.
  const [first, ...rest] = NET;
  const at = js.indexOf(first!.from);
  if (at < 0) throw new Error(`net.js: não achei o trecho ${JSON.stringify(first!.from)}`);
  const head = js.slice(0, at) + first!.to + js.slice(at + first!.from.length);
  return check("net.js", apply("net.js", head, rest));
}
