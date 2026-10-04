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
  joinRoom: (code: string, nickname: string) =>
    request<JoinGrant>("/api/token", { method: "POST", body: JSON.stringify({ code, nickname }) }),
};
