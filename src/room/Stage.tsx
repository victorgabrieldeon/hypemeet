import type { TileModel } from "./model";
import { pluginTileId, PluginTile, type PluginSession } from "./plugins";
import { Tile } from "./Tile";
import { useSize } from "./useSize";
import { WATCH_TILE_ID, type WatchParty } from "./watch";
import { WatchTile } from "./WatchPlayer";

const GAP = 12;
const ASPECT = 16 / 9;

/** Picks the column count that makes 16:9 tiles as large as possible inside the box. */
function fitGrid(width: number, height: number, count: number) {
  let best = { tileWidth: 0, tileHeight: 0 };
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    // floor: sub-pixel overflow would make flex-wrap push the last tile onto an extra row.
    const tileWidth = Math.floor(
      Math.min((width - GAP * (cols - 1)) / cols, ((height - GAP * (rows - 1)) / rows) * ASPECT),
    );
    if (tileWidth > best.tileWidth) best = { tileWidth, tileHeight: tileWidth / ASPECT };
  }
  return best;
}

interface StageProps {
  tiles: TileModel[];
  /**
   * A live watch party: one more tile, first in line. Its player lives outside the stage (so it never
   * reloads); pinning it leaves the stage just the strip of everyone else.
   */
  watch?: WatchParty | null;
  /** False when this viewer opted out of the session: its tile offers to join instead. */
  watchJoined?: boolean;
  /** Plugins someone has open: a tile each, after the watch party's. Like it, their pages live outside the stage. */
  plugins?: PluginSession[];
  pinnedId: string | null;
  onPin: (id: string | null) => void;
}

export function Stage({ tiles, watch, watchJoined = true, plugins = [], pinnedId, onPin }: StageProps) {
  const [ref, { width, height }] = useSize<HTMLDivElement>();
  const pluginPinned = plugins.find((p) => p.open && pinnedId === pluginTileId(p.info.id));
  // A pinned watch party or plugin takes the space above; the stage keeps just the strip.
  const watchPinned = !!watch && watchJoined && pinnedId === WATCH_TILE_ID;
  const viewPinned = watchPinned || !!pluginPinned;
  const pinned = tiles.find((t) => t.id === pinnedId);
  const toggle = (id: string) => onPin(pinnedId === id ? null : id);

  const strip = (others: TileModel[]) => (
    <div className="scrollbar-thin flex h-28 shrink-0 gap-3 overflow-x-auto sm:h-32">
      {!watchPinned && watch && (
        <div className="aspect-video h-full shrink-0">
          <WatchTile party={watch} joined={watchJoined} compact onOpen={() => onPin(WATCH_TILE_ID)} />
        </div>
      )}
      {plugins
        .filter((p) => p !== pluginPinned)
        .map((p) => (
          <div key={p.info.id} className="aspect-video h-full shrink-0">
            <PluginTile session={p} compact onOpen={() => onPin(pluginTileId(p.info.id))} />
          </div>
        ))}
      {others.map((tile) => (
        <div key={tile.id} className="aspect-video h-full shrink-0">
          <Tile tile={tile} pinned={false} compact onTogglePin={() => toggle(tile.id)} />
        </div>
      ))}
    </div>
  );

  let content;
  if (viewPinned) {
    content = strip(tiles);
  } else if (pinned) {
    const others = tiles.filter((t) => t !== pinned);
    content = (
      <div className="flex size-full flex-col gap-3">
        <div className="min-h-0 flex-1">
          <Tile tile={pinned} pinned onTogglePin={() => toggle(pinned.id)} />
        </div>
        {(others.length > 0 || watch || plugins.length > 0) && strip(others)}
      </div>
    );
  } else {
    const { tileWidth, tileHeight } = fitGrid(width, height, tiles.length + (watch ? 1 : 0) + plugins.length);
    content = (
      <div className="flex size-full flex-wrap content-center justify-center" style={{ gap: GAP }}>
        {tileWidth > 0 && watch && (
          <div style={{ width: tileWidth, height: tileHeight }}>
            <WatchTile party={watch} joined={watchJoined} onOpen={() => onPin(WATCH_TILE_ID)} />
          </div>
        )}
        {tileWidth > 0 &&
          plugins.map((p) => (
            <div key={p.info.id} style={{ width: tileWidth, height: tileHeight }}>
              <PluginTile session={p} onOpen={() => onPin(pluginTileId(p.info.id))} />
            </div>
          ))}
        {tileWidth > 0 &&
          tiles.map((tile) => (
            <div key={tile.id} style={{ width: tileWidth, height: tileHeight }}>
              <Tile tile={tile} pinned={false} onTogglePin={() => toggle(tile.id)} />
            </div>
          ))}
      </div>
    );
  }

  // Single observed box; the layouts inside fill it absolutely so they never feed back into its size.
  return (
    <div ref={ref} className={`relative ${viewPinned ? "h-28 shrink-0 sm:h-32" : "min-h-0 flex-1"}`}>
      <div className="absolute inset-0">{content}</div>
    </div>
  );
}
