import { useEffect, useRef, useState } from "react";
import { FADE_MS, HOLD_MS, PING_MS, useInk, type InkTool, type ScreenInk } from "./ink";
import { useSize } from "./useSize";

/** A press that moves less than this (CSS px) before lifting is a ping, not a stroke. */
const DRAG_PX = 5;

/** Where an object-contain picture of this aspect sits inside the box. */
function fitContain(box: { width: number; height: number }, aspect: number | null) {
  if (!aspect || !box.width || !box.height) return { left: 0, top: 0, ...box };
  const width = Math.min(box.width, box.height * aspect);
  const height = width / aspect;
  return { left: (box.width - width) / 2, top: (box.height - height) / 2, width, height };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOut = (t: number) => 1 - (1 - t) ** 3;

function strokeAlpha(doneAt: number | null, now: number) {
  if (doneAt === null) return 1;
  return clamp01(1 - (now - doneAt - HOLD_MS) / FADE_MS);
}

/** Author tag next to someone else's mark, kept inside the picture. */
function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, width: number, height: number) {
  const name = text.length > 18 ? `${text.slice(0, 17)}…` : text;
  ctx.save();
  ctx.shadowColor = "transparent";
  ctx.font = "600 12px 'Inter Variable', sans-serif";
  const w = ctx.measureText(name).width + 12;
  const h = 20;
  const left = Math.max(2, Math.min(x + 10, width - w - 2));
  const top = Math.max(2, Math.min(y - h - 6, height - h - 2));
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(left, top, w, h, 6);
  ctx.fill();
  ctx.fillStyle = "#07070c";
  ctx.textBaseline = "middle";
  ctx.fillText(name, left + 6, top + h / 2 + 0.5);
  ctx.restore();
}

/** Smooth freehand line: quadratic curves through the midpoints between samples. */
function penPath(ctx: CanvasRenderingContext2D, p: number[]) {
  ctx.beginPath();
  ctx.moveTo(p[0]!, p[1]!);
  for (let i = 2; i < p.length - 2; i += 2) {
    ctx.quadraticCurveTo(p[i]!, p[i + 1]!, (p[i]! + p[i + 2]!) / 2, (p[i + 1]! + p[i + 3]!) / 2);
  }
  ctx.lineTo(p.at(-2)!, p.at(-1)!);
  ctx.stroke();
}

function arrowPath(ctx: CanvasRenderingContext2D, [x0, y0, x1, y1]: number[], line: number) {
  const length = Math.hypot(x1! - x0!, y1! - y0!);
  if (length < 1) return;
  const angle = Math.atan2(y1! - y0!, x1! - x0!);
  const head = Math.min(line * 4.5, length * 0.6);
  // Shaft stops inside the head so its round cap doesn't poke past the tip.
  const back = head * 0.6;
  ctx.beginPath();
  ctx.moveTo(x0!, y0!);
  ctx.lineTo(x1! - Math.cos(angle) * back, y1! - Math.sin(angle) * back);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1!, y1!);
  for (const side of [-1, 1]) {
    ctx.lineTo(x1! - head * Math.cos(angle + side * 0.45), y1! - head * Math.sin(angle + side * 0.45));
  }
  ctx.closePath();
  ctx.lineWidth = line * 0.6;
  ctx.fill();
  ctx.stroke();
}

function paint(ctx: CanvasRenderingContext2D, ink: ScreenInk, width: number, height: number, now: number) {
  // One name tag per author, on their newest mark; a tag on every stroke would bury the picture.
  const tags = new Map<string, { x: number; y: number; color: string; alpha: number; at: number }>();
  const tag = (name: string | null, x: number, y: number, color: string, alpha: number, at: number) => {
    if (name && at >= (tags.get(name)?.at ?? -Infinity)) tags.set(name, { x, y, color, alpha, at });
  };
  // Scales with the picture so a mark looks the same in a thumbnail and in full screen.
  const line = Math.max(2, width * 0.0035);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // Dark halo so ink reads on light and dark content alike.
  ctx.shadowColor = "rgb(0 0 0 / 0.55)";
  ctx.shadowBlur = line * 1.5;
  for (const stroke of ink.strokes.values()) {
    if (stroke.points.length < 4) continue;
    const p = stroke.points.map((v, i) => v * (i % 2 ? height : width));
    const alpha = strokeAlpha(stroke.doneAt, now);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = ctx.fillStyle = stroke.color;
    ctx.lineWidth = line;
    if (stroke.tool === "arrow") {
      arrowPath(ctx, p, line);
      // At the tail: the head is pointing at something.
      tag(stroke.name, p[0]!, p[1]!, stroke.color, alpha, stroke.touchedAt);
    } else {
      penPath(ctx, p);
      tag(stroke.name, p.at(-2)!, p.at(-1)!, stroke.color, alpha, stroke.touchedAt);
    }
  }
  const radius = Math.max(18, width * 0.035);
  for (const ping of ink.pings) {
    const t = clamp01((now - ping.at) / PING_MS);
    const x = ping.x * width;
    const y = ping.y * height;
    ctx.strokeStyle = ctx.fillStyle = ping.color;
    // Two ripples, the second trailing the first.
    for (const delay of [0, 0.22]) {
      const k = clamp01((t - delay) / (1 - delay));
      if (k <= 0 || k >= 1) continue;
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = line * (1.4 - k);
      ctx.beginPath();
      ctx.arc(x, y, radius * easeOut(k), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1 - t ** 3;
    ctx.beginPath();
    ctx.arc(x, y, line * 1.8, 0, Math.PI * 2);
    ctx.fill();
    tag(ping.name, x, y, ping.color, 1 - t ** 3, ping.at);
  }
  for (const [name, { x, y, color, alpha }] of tags) {
    ctx.globalAlpha = alpha;
    label(ctx, name, x, y, color, width, height);
  }
  ctx.globalAlpha = 1;
}

interface InkLayerProps {
  /** The screen's video track sid, the same for everyone in the room. */
  screen: string;
  /** Width/height of the shared picture; null until its first frame. */
  aspect: number | null;
  /** Tool in hand, or null when just watching others' ink. */
  tool: InkTool | null;
}

/**
 * Canvas over a screen's picture (letterbox excluded) that shows everyone's ink and, with a tool in
 * hand, draws: drag for a stroke, click for a ping.
 */
export function InkLayer({ screen, aspect, tool }: InkLayerProps) {
  const ink = useInk();
  const [boxRef, box] = useSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rect = fitContain(box, aspect);
  /** The press in progress; id stays null until it has moved far enough to be a stroke. */
  const gesture = useRef<{ id: string | null; x: number; y: number; clientX: number; clientY: number } | null>(null);
  // Any layer over the video gets blended into every one of its frames, which without a GPU (software
  // compositing) costs the screen real fps. So the canvas only exists while there's ink or a tool in hand.
  const [inked, setInked] = useState(() => !!ink.visible(screen, performance.now()));
  const shown = inked || !!tool;

  useEffect(() => {
    setInked(!!ink.visible(screen, performance.now()));
    return ink.subscribe(screen, () => setInked(true));
  }, [ink, screen]);

  // Animates only while there's ink on this screen; the store wakes it when something new arrives.
  useEffect(() => {
    if (!shown) return;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    let frame = 0;
    const draw = (now: number) => {
      frame = 0;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      const marks = ink.visible(screen, now);
      if (!marks) return setInked(false);
      paint(ctx, marks, rect.width, rect.height, now);
      frame = requestAnimationFrame(draw);
    };
    const wake = () => {
      frame ||= requestAnimationFrame(draw);
    };
    wake();
    const unsubscribe = ink.subscribe(screen, wake);
    return () => {
      cancelAnimationFrame(frame);
      unsubscribe();
    };
  }, [ink, screen, shown, rect.width, rect.height]);

  // Putting the tool down (or the tile going away) ends a stroke left mid-air.
  useEffect(
    () => () => {
      const id = gesture.current?.id;
      gesture.current = null;
      if (id) ink.finish(id);
    },
    [ink, tool],
  );

  const point = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return [clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height)] as const;
  };

  return (
    <div ref={boxRef} className="pointer-events-none absolute inset-0">
      {shown && (
        <canvas
          ref={canvasRef}
          className={`absolute touch-none ${tool ? "pointer-events-auto cursor-crosshair" : ""}`}
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
          onPointerDown={(e) => {
            if (!tool || e.button !== 0) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            const [x, y] = point(e);
            gesture.current = { id: null, x, y, clientX: e.clientX, clientY: e.clientY };
          }}
          onPointerMove={(e) => {
            const g = gesture.current;
            if (!g || !tool) return;
            if (g.id === null) {
              if (Math.hypot(e.clientX - g.clientX, e.clientY - g.clientY) < DRAG_PX) return;
              g.id = ink.start(screen, tool, g.x, g.y);
            }
            // Coalesced samples keep fast pen strokes smooth; an arrow only needs the latest.
            const samples = tool === "pen" ? (e.nativeEvent.getCoalescedEvents?.() ?? []) : [];
            for (const sample of samples.length > 0 ? samples : [e.nativeEvent]) ink.extend(g.id, ...point(sample));
          }}
          onPointerUp={() => {
            const g = gesture.current;
            gesture.current = null;
            if (!g) return;
            if (g.id === null) ink.ping(screen, g.x, g.y);
            else ink.finish(g.id);
          }}
          onPointerCancel={() => {
            const id = gesture.current?.id;
            gesture.current = null;
            if (id) ink.finish(id);
          }}
          // Drawing shouldn't pin the tile.
          onDoubleClick={(e) => tool && e.stopPropagation()}
        />
      )}
    </div>
  );
}
