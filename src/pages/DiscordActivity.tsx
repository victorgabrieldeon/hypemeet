import { Common, DiscordSDK, Events, RPCCloseCodes } from "@discord/embedded-app-sdk";
import { ExternalLink } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button, Logo, Spinner, glowCardClass } from "../components/ui";
import { api, type DiscordGrant } from "../lib/api";
import { discordClientId, proxiedLiveKitUrl } from "../lib/discord";
import { LiveRoom } from "./RoomPage";

// Only loaded inside Discord (see main.tsx), so the SDK can start with the module.
const sdk = new DiscordSDK(discordClientId!);

let signedIn: Promise<string> | null = null;

/** Handshake with the Discord client and sign in once per page; resolves to the OAuth access token. */
function signIn(): Promise<string> {
  signedIn ??= (async () => {
    await sdk.ready();
    // Clicks reach the Activity in Discord's picture-in-picture, for its "Janela flutuante" button. Web and
    // desktop only: the mobile clients refuse it, and the window just stays as Discord makes it.
    void sdk.commands.setConfig({ use_interactive_pip: true }).catch(() => undefined);
    // Asks for consent the first time only; after that it's silent.
    const { code } = await sdk.commands.authorize({
      client_id: sdk.clientId,
      response_type: "code",
      state: "",
      prompt: "none",
      scope: ["identify", "guilds"],
    });
    const { accessToken } = await api.discordToken(code);
    await sdk.commands.authenticate({ access_token: accessToken });
    return accessToken;
  })().catch((err) => {
    signedIn = null;
    throw err;
  });
  return signedIn;
}

/** The grant for this voice channel's room, with LiveKit routed through Discord's proxy. */
async function joinChannelRoom(): Promise<DiscordGrant> {
  const accessToken = await signIn();
  const channelId = sdk.channelId;
  if (!channelId) throw new Error("Abra o HypeMeet a partir de um canal de voz.");
  const channelName = await sdk.commands.getChannel({ channel_id: channelId }).then(
    (c) => c.name ?? null,
    () => null, // DMs need another scope; the room is just called "Discord" then.
  );
  const grant = await api.discordJoin({ accessToken, channelId, channelName });
  return { ...grant, url: proxiedLiveKitUrl(grant.url) };
}

type Phase = { step: "loading" } | { step: "error"; message: string } | { step: "live"; grant: DiscordGrant };

/** Whether Discord has shrunk the Activity into its picture-in-picture (you went elsewhere in the client). */
function useDiscordPip(signedIn: boolean): boolean {
  const [pip, setPip] = useState(false);
  useEffect(() => {
    if (!signedIn) return;
    const onLayout = ({ layout_mode }: { layout_mode: number }) => setPip(layout_mode === Common.LayoutModeTypeObject.PIP);
    void sdk.subscribe(Events.ACTIVITY_LAYOUT_MODE_UPDATE, onLayout).catch(() => undefined);
    return () => void sdk.unsubscribe(Events.ACTIVITY_LAYOUT_MODE_UPDATE, onLayout).catch(() => undefined);
  }, [signedIn]);
  return pip;
}

/** HypeMeet as a Discord Activity: straight into the voice channel's room, as your Discord self. */
export function DiscordActivity() {
  const [phase, setPhase] = useState<Phase>({ step: "loading" });

  const join = useCallback(() => {
    setPhase({ step: "loading" });
    let cancelled = false;
    joinChannelRoom().then(
      (grant) => {
        if (cancelled) return;
        document.title = `${grant.room.name} · HypeMeet`;
        setPhase({ step: "live", grant });
      },
      (err: Error) => !cancelled && setPhase({ step: "error", message: err.message }),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(join, [join]);

  const discordPip = useDiscordPip(phase.step === "live");
  const openOutside = (url: string) => void sdk.commands.openExternalLink({ url }).catch(() => undefined);

  if (phase.step === "loading") {
    return (
      <div className="grid h-full place-items-center">
        <div className="flex flex-col items-center gap-4 text-soft">
          <Spinner className="size-7" /> Entrando pelo Discord…
        </div>
      </div>
    );
  }

  if (phase.step === "error") {
    return (
      <div className="aurora grid min-h-full place-items-center px-4 py-10">
        <div className={`${glowCardClass} flex w-full max-w-md animate-pop flex-col gap-7 p-6 sm:p-10`}>
          <Logo />
          <div>
            <h1 className="type-heading-sm text-2xl">Não deu para abrir a sala</h1>
            <p className="mt-2 break-words text-soft">{phase.message}</p>
          </div>
          <Button variant="primary" onClick={join}>
            Tentar de novo
          </Button>
        </div>
      </div>
    );
  }

  const { grant } = phase;
  return (
    <LiveRoom
      key={grant.token}
      info={grant.room}
      grant={grant}
      devices={{ mic: false, camera: false }}
      onLeave={() => sdk.close(RPCCloseCodes.CLOSE_NORMAL, "Saiu da sala")}
      onRejoin={join}
      inviteUrl={grant.webUrl}
      onInvite={() => void sdk.commands.openInviteDialog().catch(() => undefined)}
      onCast={async (withCamera) => {
        const { url } = await api.castLink(grant.token);
        await sdk.commands.openExternalLink({ url: withCamera ? `${url}&cam=1` : url });
      }}
      youTubeStream={(videoId) => api.youTubeStream(videoId, grant.token)}
      discordPip={discordPip}
      connectErrorExtra={
        <div className="flex flex-col gap-3">
          <p className="text-sm text-soft">
            O Discord pode estar barrando a conexão de áudio e vídeo da atividade. A mesma sala abre no navegador ou
            no app.
          </p>
          <Button onClick={() => openOutside(grant.webUrl)}>
            <ExternalLink className="size-4" /> Abrir fora do Discord
          </Button>
        </div>
      }
    />
  );
}
