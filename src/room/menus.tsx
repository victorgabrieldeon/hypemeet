import { Room, RoomEvent } from "livekit-client";
import { Check, ChevronUp } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { canPickSpeaker, saveDevice, type DeviceKind } from "./devices";
import { isScreenAudioDevice } from "./model";

/** Closes a popover on a pointer press outside `ref` or on Escape, while `open`. */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
 useEffect(() => {
  if (!open) return;
  const onPointer = (e: PointerEvent) => {
   if (!ref.current?.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
  document.addEventListener("pointerdown", onPointer);
  document.addEventListener("keydown", onKey);
  return () => {
   document.removeEventListener("pointerdown", onPointer);
   document.removeEventListener("keydown", onKey);
  };
 }, [ref, open, close]);
}

/** Popover box that opens above its trigger; the trigger's wrapper must be `relative`. */
const MENU_PANEL_CLASS =
 "absolute bottom-full left-1/2 z-40 mb-3 w-[min(18rem,calc(100vw-1.5rem))] -translate-x-1/2 animate-pop rounded-lg bg-canvas p-2 shadow-float ring-1 ring-line";

/**
 * Small chevron pinned to the corner of a control button that opens a menu above it.
 * Wrap the control button and this in a `relative` element.
 */
export function MenuChevron({ label, children }: { label: string; children: (close: () => void) => ReactNode }) {
 const [open, setOpen] = useState(false);
 const ref = useRef<HTMLDivElement>(null);
 useDismiss(ref, open, () => setOpen(false));

 return (
  <div ref={ref} className="contents">
   <button
    onClick={() => setOpen(!open)}
    aria-label={label}
    aria-expanded={open}
    title={label}
    className="absolute -right-1 -bottom-1 z-10 grid size-6 place-items-center rounded-full bg-surface-hi text-ink ring-2 ring-panel transition hover:bg-blurple"
   >
    <ChevronUp className={`size-3.5 transition ${open ? "" : "rotate-180"}`} />
   </button>
   {open && (
    <div role="menu" className={MENU_PANEL_CLASS}>
     {children(() => setOpen(false))}
    </div>
   )}
  </div>
 );
}

export function MenuSection({ title, children }: { title: string; children: ReactNode }) {
 return (
  <div className="flex flex-col gap-0.5 [&+&]:mt-2 [&+&]:border-t [&+&]:border-line [&+&]:pt-2">
   <p className="px-2.5 pt-1 pb-1.5 text-xs font-bold tracking-wide text-soft uppercase">{title}</p>
   {children}
  </div>
 );
}

function MenuItem({
 active,
 onClick,
 children,
}: {
 active: boolean;
 onClick: () => void;
 children: ReactNode;
}) {
 return (
  <button
   role="menuitemradio"
   aria-checked={active}
   onClick={onClick}
   className={`flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-sm transition ${active ? "bg-surface text-ink" : "text-soft hover:bg-surface hover:text-ink"
    }`}
  >
   <span className="min-w-0 flex-1">{children}</span>
   {active && <Check className="size-4 shrink-0 text-blurple" />}
  </button>
 );
}

/** On/off row that keeps the menu open, so the change can be heard right away. */
export function MenuToggle({
 checked,
 onChange,
 label,
 hint,
}: {
 checked: boolean;
 onChange: (checked: boolean) => void;
 label: string;
 hint: string;
}) {
 return (
  <button
   role="menuitemcheckbox"
   aria-checked={checked}
   onClick={() => onChange(!checked)}
   className="flex w-full items-center gap-3 rounded-sm px-2.5 py-2 text-left transition hover:bg-surface"
  >
   <span className="min-w-0 flex-1 text-sm">
    <span className="block font-medium text-ink">{label}</span>
    <span className="block text-xs text-soft">{hint}</span>
   </span>
   <span className={`relative h-6 w-10 shrink-0 rounded-full transition ${checked ? "bg-blurple" : "bg-surface-hi"}`}>
    <span
     className={`absolute top-1 left-1 size-4 rounded-full bg-ink shadow transition-transform duration-200 ease-out-expo ${checked ? "translate-x-4" : ""
      }`}
    />
   </span>
  </button>
 );
}

const KIND_TITLES: Record<DeviceKind, string> = {
 audioinput: "Microfone",
 audiooutput: "Saída de áudio",
 videoinput: "Câmera",
};

export function DeviceMenu({
 room,
 kinds,
 onError,
 close,
}: {
 room: Room;
 kinds: DeviceKind[];
 onError: (message: string) => void;
 close: () => void;
}) {
 const [devices, setDevices] = useState<MediaDeviceInfo[] | null>(null);

 useEffect(() => {
  let cancelled = false;
  // requestPermissions=false: never pop a permission prompt just to list devices.
  const load = () =>
   Room.getLocalDevices(undefined, false)
    .then((list) => !cancelled && setDevices(list))
    .catch(() => !cancelled && setDevices([]));
  void load();
  room.on(RoomEvent.MediaDevicesChanged, load);
  return () => {
   cancelled = true;
   room.off(RoomEvent.MediaDevicesChanged, load);
  };
 }, [room]);

 async function pick(kind: DeviceKind, deviceId: string) {
  close();
  try {
   await room.switchActiveDevice(kind, deviceId);
   saveDevice(kind, deviceId);
  } catch (err) {
   onError(`Não deu pra trocar ${KIND_TITLES[kind].toLowerCase()}: ${(err as Error).message}`);
  }
 }

 if (!devices) return <p className="px-2.5 py-2 text-sm text-soft">Procurando dispositivos…</p>;

 return (
  <>
   {kinds
    .filter((kind) => kind !== "audiooutput" || canPickSpeaker)
    .map((kind) => {
     const ofKind = devices.filter((d) => d.kind === kind && d.deviceId && !isScreenAudioDevice(d));
     const activeId = room.getActiveDevice(kind);
     // Unknown/unset active id → the browser's "default" entry (or the first one) is what's in use.
     const selected =
      ofKind.find((d) => d.deviceId === activeId) ?? ofKind.find((d) => d.deviceId === "default") ?? ofKind[0];
     return (
      <MenuSection key={kind} title={KIND_TITLES[kind]}>
       {ofKind.length === 0 ? (
        <p className="px-2.5 py-1.5 text-sm text-soft">Nenhum encontrado</p>
       ) : (
        ofKind.map((device, i) => (
         <MenuItem
          key={device.deviceId}
          active={device === selected}
          onClick={() => void pick(kind, device.deviceId)}
         >
          <span className="block truncate">{device.label || `${KIND_TITLES[kind]} ${i + 1}`}</span>
         </MenuItem>
        ))
       )}
      </MenuSection>
     );
    })}
  </>
 );
}

