import { useEffect, useRef, useState } from "react";
import type { TileModel } from "./model";
import { Tile } from "./Tile";

const GAP = 12;
const ASPECT = 16 / 9;

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      setSize({ width, height });
    });
    observer.observe(ref.current!);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

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
  pinnedId: string | null;
  onPin: (id: string | null) => void;
}

export function Stage({ tiles, pinnedId, onPin }: StageProps) {
  const [ref, { width, height }] = useSize<HTMLDivElement>();
  const pinned = tiles.find((t) => t.id === pinnedId);
  const toggle = (id: string) => onPin(pinnedId === id ? null : id);

  let content;
  if (pinned) {
    const others = tiles.filter((t) => t !== pinned);
    content = (
      <div className="flex size-full flex-col gap-3">
        <div className="min-h-0 flex-1">
          <Tile tile={pinned} pinned onTogglePin={() => toggle(pinned.id)} />
        </div>
        {others.length > 0 && (
          <div className="scrollbar-thin flex h-28 shrink-0 gap-3 overflow-x-auto sm:h-32">
            {others.map((tile) => (
              <div key={tile.id} className="aspect-video h-full shrink-0">
                <Tile tile={tile} pinned={false} compact onTogglePin={() => toggle(tile.id)} />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  } else {
    const { tileWidth, tileHeight } = fitGrid(width, height, tiles.length);
    content = (
      <div className="flex size-full flex-wrap content-center justify-center" style={{ gap: GAP }}>
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
    <div ref={ref} className="relative min-h-0 flex-1">
      <div className="absolute inset-0">{content}</div>
    </div>
  );
}
