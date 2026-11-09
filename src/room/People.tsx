import { Track, type Participant, type Room } from "livekit-client";
import { HeadphoneOff, Headphones, Mic, MicOff, UserX, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { Avatar, cardClass, Spinner } from "../components/ui";
import { api, type Moderation, type ModerationAction } from "../lib/api";
import { inDiscord } from "../lib/discord";
import { remotePeople } from "./cast";
import { discordAvatar, nameOf } from "./model";
import { byJoinOrder } from "./watch";

/** Whether these permissions let a participant publish that source (LiveKit reads an empty list as every source). */
export function mayPublish(permissions: Participant["permissions"], source: Track.Source): boolean {
  // Not known yet: don't claim a restriction.
  if (!permissions) return true;
  const { canPublish, canPublishSources } = permissions;
  return canPublish && (canPublishSources.length === 0 || canPublishSources.includes(Track.sourceToProto(source)));
}

// DESIGN.md's secondary destructive action: danger outline, solid danger with dark text on hover.
const DANGER_OUTLINE =
  "border-[color-mix(in_srgb,var(--color-danger)_40%,var(--color-surface))] bg-surface text-danger hover:border-danger hover:bg-danger hover:text-on-accent";

function ModButton({
  label,
  icon: Icon,
  busy,
  danger = false,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  busy: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={label}
      title={label}
      className={`grid size-9 shrink-0 place-items-center rounded-full border-2 shadow-sticker transition hover:-translate-y-px active:translate-y-px active:shadow-none disabled:translate-y-0 disabled:opacity-60 ${danger ? DANGER_OUTLINE : "border-line bg-surface text-ink hover:bg-surface-hi"}`}
    >
      {busy ? <Spinner className="size-4" /> : <Icon className="size-4" />}
    </button>
  );
}

/** The header's "Pessoas" popover: who is in the room and, with Discord permissions, the moderation buttons. */
export function PeoplePanel({
  room,
  token,
  moderation,
  onError,
}: {
  room: Room;
  token: string;
  moderation?: Moderation;
  onError: (text: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const local = room.localParticipant;
  // Transmitters stay out (remotePeople), so they never get moderation buttons.
  const people = [local, ...remotePeople(room)].toSorted(byJoinOrder);

  async function act(identity: string, action: ModerationAction) {
    setBusy(`${identity}:${action}`);
    try {
      await api.moderate(token, identity, action);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Pessoas"
      className={`absolute top-full right-0 z-40 mt-2 flex max-h-[min(28rem,70vh)] w-[min(22rem,calc(100vw-1.5rem))] animate-pop flex-col gap-0.5 overflow-y-auto p-2 ${cardClass}`}
    >
      <p className="type-label px-3 pt-1.5 pb-2 text-soft">Pessoas · {people.length}</p>
      {people.map((p) => {
        const name = nameOf(p);
        const isLocal = p === local;
        const silenced = !mayPublish(p.permissions, Track.Source.Microphone);
        const deafened = p.attributes.deafened === "1";
        // In the Activity the voice is Discord's, so HypeMeet's mic state would just be noise (as on the tiles).
        const status = [
          silenced ? "sem permissão para falar" : inDiscord ? null : p.isMicrophoneEnabled ? "microfone ligado" : "microfone desligado",
          deafened ? "ensurdecido" : null,
        ]
          .filter(Boolean)
          .join(" · ");
        const run = (action: ModerationAction) => () => void act(p.identity, action);
        const isBusy = (action: ModerationAction) => busy === `${p.identity}:${action}`;
        return (
          <div key={p.identity} className="flex items-center gap-3 rounded-md px-2 py-1.5">
            <Avatar name={name} seed={p.identity} image={discordAvatar(p)} size="sm" />
            <div className="min-w-0 flex-1 text-sm">
              <p className="truncate font-bold text-ink">
                {name} {isLocal && <span className="text-xs font-medium text-soft">(você)</span>}
              </p>
              {status && <p className="truncate text-xs font-medium text-soft">{status}</p>}
            </div>
            {moderation && !isLocal && (
              <div className="flex shrink-0 gap-1">
                {moderation.mute &&
                  (silenced ? (
                    <ModButton label="Permitir falar" icon={Mic} busy={isBusy("unmute")} onClick={run("unmute")} />
                  ) : (
                    <ModButton label="Silenciar no servidor" icon={MicOff} busy={isBusy("mute")} onClick={run("mute")} />
                  ))}
                {moderation.deafen &&
                  (deafened ? (
                    <ModButton
                      label="Tirar ensurdecimento"
                      icon={Headphones}
                      busy={isBusy("undeafen")}
                      onClick={run("undeafen")}
                    />
                  ) : (
                    <ModButton label="Ensurdecer" icon={HeadphoneOff} busy={isBusy("deafen")} onClick={run("deafen")} />
                  ))}
                {moderation.disconnect && (
                  <ModButton label="Desconectar" icon={UserX} danger busy={isBusy("disconnect")} onClick={run("disconnect")} />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
