export interface RoomInfo {
  code: string;
  name: string;
  createdAt: number;
}

export interface JoinGrant {
  token: string;
  /** null → LiveKit is reachable on this page's own origin (dev proxy). */
  url: string | null;
  room: RoomInfo;
}

/** Joining from the Discord Activity: also carries the room's address on the open web. */
export interface DiscordGrant extends JoinGrant {
  webUrl: string;
}

export interface PresentPerson {
  identity: string;
  name: string;
}

/** Room code → people connected right now. Empty rooms are absent. */
export type Presence = Record<string, PresentPerson[]>;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
    });
  } catch {
    throw new ApiError("Sem conexão com o servidor", 0);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(body?.error ?? `Erro ${res.status}`, res.status);
  return body as T;
}

export const api = {
  createRoom: (name: string) =>
    request<RoomInfo>("/api/rooms", { method: "POST", body: JSON.stringify({ name }) }),
  getRoom: (code: string) => request<RoomInfo>(`/api/rooms/${encodeURIComponent(code)}`),
  presence: (codes: string[]) => request<Presence>(`/api/presence?codes=${codes.map(encodeURIComponent).join(",")}`),
  joinRoom: (code: string, nickname: string) =>
    request<JoinGrant>("/api/token", { method: "POST", body: JSON.stringify({ code, nickname }) }),
  discordToken: (code: string) =>
    request<{ accessToken: string }>("/api/discord/token", { method: "POST", body: JSON.stringify({ code }) }),
  discordJoin: (body: { accessToken: string; channelId: string; channelName: string | null }) =>
    request<DiscordGrant>("/api/discord/join", { method: "POST", body: JSON.stringify(body) }),
};
