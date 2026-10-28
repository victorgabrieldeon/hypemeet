import { MonitorUp } from "lucide-react";
import { VideoView } from "./media";
import type { TileModel } from "./model";
import { floatableTrack } from "./pip";
import { ReactionLayer } from "./reactions";
import { Pill, PipButton } from "./Tile";

/**
 * The Discord Activity while Discord has it in picture-in-picture: a small window in a corner of the client,
 * where the room doesn't fit. Just one video fills it (see pipFocus), with "Janela flutuante" to take it out
 * of Discord and onto the desktop.
 */
export function PipStage({ tile }: { tile: TileModel | null }) {
  const track = tile ? floatableTrack(tile) : undefined;
  if (!tile || !track)
    return (
      <div className="grid size-full place-items-center bg-[radial-gradient(circle_at_50%_45%,rgb(88_101_242/0.3),transparent_70%)] text-sm text-soft">
        <span className="flex items-center gap-2">
          <MonitorUp className="size-4" /> Ninguém transmitindo
        </span>
      </div>
    );
  const name = tile.participant.name || tile.participant.identity;
  return (
    <div className="relative size-full overflow-hidden bg-black">
      <VideoView key={tile.id} track={track} fit="contain" />
      <div className="absolute bottom-1.5 left-1.5 max-w-[calc(100%-3.5rem)]">
        <Pill>
          {tile.kind === "screen" && <MonitorUp className="size-3.5 shrink-0" />}
          <span className="truncate">{tile.kind === "screen" ? `Tela de ${name}` : name}</span>
        </Pill>
      </div>
      <div className="absolute right-1.5 bottom-1.5">
        <PipButton tile={tile} />
      </div>
      <ReactionLayer tileId={tile.id} compact />
    </div>
  );
}
