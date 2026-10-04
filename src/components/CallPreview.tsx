import { AudioLines, Ellipsis, Mic, MonitorUp, PhoneOff, UserRound, Video } from "lucide-react";

/** Vector dunes under a ringed horizon — stands in for a shared screen. */
function ScreenArt() {
  return (
    <svg viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full">
      <defs>
        <linearGradient id="cp-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1b1757" />
          <stop offset="0.65" stopColor="#0b0b1e" />
        </linearGradient>
        <radialGradient id="cp-planet" cx="0.35" cy="0.3" r="0.9">
          <stop offset="0" stopColor="#262070" />
          <stop offset="1" stopColor="#0c0b22" />
        </radialGradient>
        <linearGradient id="cp-rim" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#8f7bff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#a594ff" />
          <stop offset="1" stopColor="#8f7bff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="cp-dune-back" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a2fb0" />
          <stop offset="1" stopColor="#0c0b20" />
        </linearGradient>
        <linearGradient id="cp-dune-front" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#24207a" />
          <stop offset="1" stopColor="#07070f" />
        </linearGradient>
      </defs>
      <rect width="320" height="200" fill="url(#cp-sky)" />
      <circle cx="232" cy="92" r="62" fill="url(#cp-planet)" />
      <path d="M180 140 A62 62 0 0 1 270 44" stroke="url(#cp-rim)" strokeWidth="1.6" fill="none" />
      <path d="M0 128 C55 98 112 104 162 132 S262 150 320 116 V200 H0Z" fill="url(#cp-dune-back)" />
      <path d="M0 128 C55 98 112 104 162 132 S262 150 320 116" stroke="#8f7bff" strokeOpacity="0.55" fill="none" />
      <path d="M0 166 C70 140 140 150 192 170 S282 178 320 158 V200 H0Z" fill="url(#cp-dune-front)" />
      <path d="M0 166 C70 140 140 150 192 170 S282 178 320 158" stroke="#6f5cff" strokeOpacity="0.5" fill="none" />
      <path d="M20 196 C110 160 210 168 320 108" stroke="#7457ff" strokeWidth="2.5" strokeOpacity="0.55" fill="none" style={{ filter: "blur(2px)" }} />
    </svg>
  );
}

function PersonTile({ speaking = false }: { speaking?: boolean }) {
  return (
    <div
      className={`relative grid flex-1 place-items-center rounded-md border bg-surface ${speaking ? "border-blurple/80 shadow-[0_0_24px_-4px_rgb(88_101_242/0.7)]" : "border-line"
        }`}
    >
      <div className="grid size-11 place-items-center rounded-full bg-surface-hi">
        <UserRound className="size-6 fill-soft/40 text-soft/70" />
      </div>
      <span className="absolute bottom-2.5 left-2.5 h-1 w-6 rounded-full bg-white/20" />
      {speaking && <AudioLines className="absolute right-2 bottom-1.5 size-4 text-blurple-hi" />}
    </div>
  );
}

/** Decorative, tilted preview of a live room for the home hero. */
export function CallPreview() {
  return (
    <div aria-hidden className="[perspective:1600px]">
      <div className="rounded-xl border border-white/[0.06] bg-panel/80 p-4 shadow-float [transform:rotateY(14deg)_rotateX(6deg)_rotateZ(-2.5deg)]">
        <div className="grid grid-cols-[1fr_9rem] gap-3">
          <div className="relative aspect-[16/11] overflow-hidden rounded-lg border border-white/[0.05]">
            <ScreenArt />
            <span className="type-label absolute top-3.5 right-3.5 flex items-center gap-1.5 rounded-full bg-black/40 px-2.5 py-1.5 text-danger">
              <span className="size-2 rounded-full bg-danger shadow-[0_0_10px_rgb(240_56_76/0.9)]" />
              Ao vivo
            </span>
          </div>
          <div className="flex flex-col gap-3">
            <PersonTile speaking />
            <PersonTile />
            <PersonTile />
          </div>
        </div>
        <div className="mx-auto mt-4 flex w-fit items-center gap-2 rounded-full border border-line bg-surface p-1.5">
          <span className="grid size-10 place-items-center rounded-full bg-surface-hi text-ink">
            <MonitorUp className="size-[18px]" />
          </span>
          <span className="grid size-10 place-items-center rounded-full text-soft">
            <Video className="size-[18px]" />
          </span>
          <span className="grid size-10 place-items-center rounded-full text-soft">
            <Mic className="size-[18px]" />
          </span>
          <span className="grid size-10 place-items-center rounded-full text-soft">
            <Ellipsis className="size-[18px]" />
          </span>
          <span className="ml-1 grid size-10 place-items-center rounded-full bg-danger text-ink">
            <PhoneOff className="size-[18px]" />
          </span>
        </div>
      </div>
    </div>
  );
}
