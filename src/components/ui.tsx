import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { personStyle } from "../lib/color";

type Variant = "primary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
 primary: "border-accent-hi bg-accent text-on-accent hover:bg-accent-hi",
 ghost: "border-line bg-surface text-ink hover:bg-surface-hi",
 danger: "border-[color-mix(in_srgb,var(--color-danger)_55%,white)] bg-danger text-on-accent hover:brightness-110",
};

type Size = "md" | "sm";

const SIZES: Record<Size, { box: string; square: string; pad: string }> = {
 md: { box: "type-link h-12", square: "w-12", pad: "px-5" },
 sm: { box: "type-link-sm h-10", square: "w-10", pad: "px-4" },
};

/** Classes of <Button>, for links that must look like one. Pill stickers that lift on hover. */
export function buttonClass({
 variant = "ghost",
 size = "md",
 square = false,
}: { variant?: Variant; size?: Size; square?: boolean } = {}) {
 const s = SIZES[size];
 return `${s.box} inline-flex shrink-0 items-center justify-center gap-2 rounded-full border-2 shadow-sticker transition duration-200 ease-out-expo hover:-translate-y-px active:translate-y-px active:shadow-none disabled:translate-y-0 disabled:opacity-50 ${square ? s.square : s.pad} ${VARIANTS[variant]}`;
}

/** Pill link in the top bar of the home and download pages. */
export const headerLinkClass =
 "type-link-sm sticker flex h-11 items-center gap-2 rounded-full bg-surface px-4 text-ink transition hover:-translate-y-px hover:bg-surface-hi active:translate-y-px active:shadow-none";

/** Small neutral pill: room code, counts, metadata. */
export const chipClass =
 "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border-[1.5px] border-line bg-surface px-3 text-[13px] font-bold text-ink";

/** Pill laid over video or a shared screen (dark, blurred, readable on anything). */
export const scrimClass = "scrim inline-flex shrink-0 items-center gap-1.5 rounded-full text-ink";

/** Someone's filled name tag; pair with style={personStyle(identity)}. */
export const personTagClass =
 "person-tag inline-flex h-6.5 max-w-full items-center gap-1.5 truncate rounded-full px-2.5 font-display text-sm leading-none font-extrabold";

/** Keyboard key, e.g. the push-to-talk binding. */
export const kbdClass =
 "inline-grid h-5.5 min-w-5.5 place-items-center rounded-[7px] border-[1.5px] border-line bg-surface px-1.5 font-mono text-xs text-ink shadow-[0_2px_0_var(--color-line)]";

/** Unread / count badge on a control. */
export const countClass =
 "grid h-5.5 min-w-5.5 place-items-center rounded-full border-2 border-canvas bg-accent px-1.5 text-xs leading-none font-extrabold text-on-accent";

export function Button({
 variant = "ghost",
 size = "md",
 square = false,
 className = "",
 ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; /** icon-only, 1:1 */ square?: boolean }) {
 return <button {...props} className={`${buttonClass({ variant, size, square })} ${className}`} />;
}

/** The grape "H" sticker (public/favicon.svg). */
export function LogoMark({ className = "size-10" }: { className?: string }) {
 return <img src="/favicon.svg" alt="" className={`shrink-0 ${className}`} />;
}

/** "Hype" plus "Meet" on a tilted grape sticker; sizes with the font size. */
function Wordmark({ className = "" }: { className?: string }) {
 return (
  <span className={`inline-flex items-center font-display font-extrabold tracking-[-0.03em] ${className}`}>
   Hype
   <span className="ml-[0.16em] inline-block -rotate-3 rounded-[0.38em] border-2 border-accent-hi bg-accent px-[0.36em] pt-[0.08em] pb-[0.18em] text-on-accent shadow-sticker">
    Meet
   </span>
  </span>
 );
}

export function Logo({ className = "" }: { className?: string }) {
 return <Wordmark className={`text-[1.75rem] leading-none ${className}`} />;
}

export function Avatar({
 name,
 seed,
 image,
 size = "md",
 shape = "circle",
 className = "",
}: {
 name: string;
 /** What picks the colour (a participant's identity, a room's code); defaults to the name. */
 seed?: string;
 /** Photo to show instead of the initials (e.g. the Discord avatar). */
 image?: string;
 size?: "xs" | "sm" | "md" | "lg";
 /** circle = a person (sticker blob in their colour); square = a room (tonal stamp). */
 shape?: "circle" | "square";
 className?: string;
}) {
 const initials =
  name
   .split(/\s+/)
   .filter(Boolean)
   .slice(0, size === "xs" ? 1 : 2)
   .map((p) => p[0]!.toUpperCase())
   .join("") || "?";
 const sizes = { xs: "size-6 text-[0.625rem]", sm: "size-9 text-sm", md: "size-12 text-base", lg: "size-24 text-3xl" };
 if (image)
  return (
   <img
    src={image}
    alt={name}
    draggable={false}
    className={`shrink-0 bg-surface-hi object-cover ${shape === "square" ? "rounded-md" : "rounded-full"} ${sizes[size]} ${className}`}
   />
  );
 const look =
  shape === "square"
   ? "rounded-blob border-2 border-[color-mix(in_srgb,var(--p)_34%,var(--color-surface))] bg-[color-mix(in_srgb,var(--p)_16%,var(--color-surface))] text-(--p)"
   : "rounded-blob bg-(--p) text-on-accent";
 return (
  <div
   style={personStyle(seed ?? name)}
   className={`grid shrink-0 place-items-center font-display font-extrabold ${look} ${sizes[size]} ${className}`}
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

/** One labelled input: bold label above, optional leading icon. */
export function Field({
 label,
 htmlFor,
 icon: Icon,
 children,
}: {
 label: string;
 htmlFor: string;
 icon?: LucideIcon;
 children: ReactNode;
}) {
 return (
  <div className="flex flex-col gap-2">
   <label htmlFor={htmlFor} className="px-0.5 text-sm font-bold text-ink">
    {label}
   </label>
   <div className={`relative ${Icon ? "[&>input]:pl-11" : ""}`}>
    {Icon && (
     <Icon className="pointer-events-none absolute top-1/2 left-4 size-[18px] -translate-y-1/2 text-soft" />
    )}
    {children}
   </div>
  </div>
 );
}

export const inputClass =
 "h-13 w-full rounded-md border-2 border-line bg-surface px-4 text-base font-medium text-ink placeholder:text-soft outline-none transition focus:border-accent";

/** The panel that holds the home, lobby and Activity forms. */
export const cardClass = "rounded-xl border-2 border-line bg-panel shadow-float";
