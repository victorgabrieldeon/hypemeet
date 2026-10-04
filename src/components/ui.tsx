import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
 primary:
  "bg-linear-to-b from-[#6873ff] to-blurple text-ink shadow-[0_8px_24px_-8px_rgb(88_101_242/0.8),inset_0_1px_0_rgb(255_255_255/0.18)] hover:brightness-110",
 ghost: "border border-line bg-surface text-ink hover:bg-surface-hi",
 danger: "bg-danger text-ink hover:brightness-110",
};

export function Button({
 variant = "ghost",
 square = false,
 className = "",
 ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; /** icon-only, 1:1 */ square?: boolean }) {
 return (
  <button
   {...props}
   className={`type-link inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-md transition duration-200 ease-out-expo active:translate-y-px disabled:opacity-50 ${square ? "w-12" : "px-5"} ${VARIANTS[variant]} ${className}`}
  />
 );
}

export function LogoMark({ className = "size-9" }: { className?: string }) {
 return <img src="/favicon.svg" alt="" className={`shrink-0 ${className}`} />;
}

/** HYPE in white, MEET in Blurple — the wordmark split from the brand reference. */
export function Wordmark({ className = "" }: { className?: string }) {
 return (
  <span className={`font-display font-extrabold tracking-[-0.01em] uppercase ${className}`}>
   Hype<span className="text-blurple-hi">Meet</span>
  </span>
 );
}

export function Logo({ className = "" }: { className?: string }) {
 return (
  <div className={`flex items-center gap-3 ${className}`}>
   <LogoMark className="size-10" />
   <Wordmark className="text-2xl" />
  </div>
 );
}

/** Violet → Blurple family only, so avatars never introduce a second accent. */
const AVATAR_FILLS = [
 "bg-linear-to-br from-[#7457ff] to-blurple",
 "bg-linear-to-br from-blurple to-[#3d47c9]",
 "bg-linear-to-br from-[#9a6bff] to-[#5b3fd6]",
 "bg-linear-to-br from-[#4c5bd4] to-[#2b2f7a]",
];

export function Avatar({
 name,
 size = "md",
 shape = "circle",
}: {
 name: string;
 size?: "sm" | "md" | "lg";
 /** square = server-icon style, used for rooms. */
 shape?: "circle" | "square";
}) {
 const initials =
  name
   .split(/\s+/)
   .filter(Boolean)
   .slice(0, 2)
   .map((p) => p[0]!.toUpperCase())
   .join("") || "?";
 let hash = 0;
 for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
 const fill = AVATAR_FILLS[Math.abs(hash) % AVATAR_FILLS.length];
 const sizes = { sm: "size-9 text-sm", md: "size-12 text-base", lg: "size-24 text-3xl" };
 return (
  <div
   className={`grid shrink-0 place-items-center font-display font-bold text-ink ${shape === "square" ? "rounded-md" : "rounded-full"} ${fill} ${sizes[size]}`}
  >
   {initials}
  </div>
 );
}

export function Spinner({ className = "size-5" }: { className?: string }) {
 return (
  <span
   className={`inline-block animate-spin rounded-full border-2 border-current/25 border-t-current ${className}`}
  />
 );
}

/**
 * Inset panel holding one input: tracked-caps label, optional leading icon, optional trailing
 * control (e.g. the submit arrow). `header` sits at the label row's right edge.
 */
export function Field({
 label,
 htmlFor,
 icon: Icon,
 header,
 trailing,
 children,
}: {
 label: string;
 htmlFor: string;
 icon?: LucideIcon;
 header?: ReactNode;
 trailing?: ReactNode;
 children: ReactNode;
}) {
 return (
  <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-3 pt-4">
   <div className="flex min-h-5 items-center justify-between gap-3 px-1">
    <label htmlFor={htmlFor} className="type-label text-soft">
     {label}
    </label>
    {header}
   </div>
   <div className="flex gap-2">
    <div className={`relative min-w-0 flex-1 ${Icon ? "[&>input]:pl-11" : ""}`}>
     {Icon && (
      <Icon className="pointer-events-none absolute top-1/2 left-4 size-[18px] -translate-y-1/2 text-soft" />
     )}
     {children}
    </div>
    {trailing}
   </div>
  </div>
 );
}

export const inputClass =
 "h-12 w-full rounded-md border border-transparent bg-surface-hi px-4 text-[15px] text-ink placeholder:text-soft/70 outline-none transition focus:border-blurple/70 focus:shadow-[0_0_0_4px_rgb(88_101_242/0.15)]";

/** The glowing card that floats over the aurora on the home and lobby screens. */
export const glowCardClass = "rounded-xl border border-white/[0.06] bg-panel/90 shadow-glow backdrop-blur-xl";
