import { RoomEvent, type ByteStreamReader, type Participant, type RemoteParticipant, type Room, type TextStreamReader } from "livekit-client";

/**
 * Room chat, sent peer to peer over LiveKit's data channel: nothing goes through our server or is
 * stored anywhere, so the conversation lives only in the browsers of whoever is in the room.
 *   text           → publishData on "chat" (one reliable packet; MAX_TEXT keeps it under the ~15 KB cap)
 *   text + image   → byte stream on "chat-image", chunked by LiveKit; the text rides in its attributes
 *   history        → on joining we ask the longest-present participant ("chat-sync"), who answers with
 *                    every message as one text stream on "chat-history". The chat survives as long as
 *                    someone stays and is gone once the room empties.
 */
const TOPIC_TEXT = "chat";
const TOPIC_IMAGE = "chat-image";
const TOPIC_SYNC = "chat-sync";
const TOPIC_HISTORY = "chat-history";

export const MAX_TEXT = 2000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Longest side of a re-encoded image. */
const MAX_IMAGE_SIDE = 2560;
/** Small PNGs (usually screenshots) are sent untouched so text in them stays crisp. */
const PNG_AS_IS_BYTES = 1.5 * 1024 * 1024;
const MAX_HISTORY_BYTES = 80 * 1024 * 1024;
const MAX_MESSAGES = 300;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export interface ChatImage {
  blob: Blob;
  /** Object URL of `blob`, revoked when the message is dropped. */
  url: string;
}

export interface ChatMessage {
  id: string;
  /** Sender's identity. Their name is kept alongside so messages outlive them leaving. */
  from: string;
  name: string;
  /** Local clock, ms. */
  time: number;
  text: string;
  /** "loading" while the bytes arrive; "lost" if the transfer broke off. */
  image?: ChatImage | "loading" | "lost";
  /** Ours, and it didn't make it out. */
  failed?: boolean;
}

export interface ChatState {
  messages: ChatMessage[];
  /** Messages from others that arrived while the panel was closed. */
  unread: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const nameOf = (participant: Participant) => participant.name || participant.identity;

function parse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function fromDataUrl(url: unknown): Blob | null {
  if (typeof url !== "string") return null;
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(url);
  if (!match) return null;
  const binary = atob(match[2]!);
  if (binary.length > MAX_IMAGE_BYTES) return null;
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: match[1] });
}

const withUrl = (blob: Blob): ChatImage => ({ blob, url: URL.createObjectURL(blob) });

/**
 * Makes a picked/pasted/dropped file ready to send. Everything but GIFs (re-encoding would freeze
 * them) and small PNGs is re-encoded: that caps the size and strips metadata like a photo's GPS.
 */
export async function prepareImage(file: Blob): Promise<Blob> {
  if (!IMAGE_TYPES.includes(file.type)) throw new Error("Formato não suportado. Envie PNG, JPEG, WebP ou GIF.");
  if (file.type === "image/gif") {
    if (file.size > MAX_IMAGE_BYTES) throw new Error("GIF grande demais (máximo 5 MB).");
    return file;
  }
  if (file.type === "image/png" && file.size <= PNG_AS_IS_BYTES) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  // toBlob silently falls back to PNG where WebP encoding is missing (Safari); JPEG then.
  for (const type of ["image/webp", "image/jpeg"]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
    if (blob?.type === type && blob.size <= MAX_IMAGE_BYTES) return blob;
  }
  throw new Error("Imagem grande demais (máximo 5 MB).");
}

/** Created with the Room, before connecting: streams arriving before a handler exists are dropped. */
export class RoomChat {
  private state: ChatState = { messages: [], unread: 0 };
  private listeners = new Set<() => void>();
  private incomingListeners = new Set<(message: ChatMessage) => void>();
  private visible = false;
  /** Who we asked for the history; only their answer is taken, and only once. */
  private historyFrom: string | null = null;

  constructor(private room: Room) {
    room.on(RoomEvent.Connected, this.requestHistory).on(RoomEvent.DataReceived, this.onData);
    room.registerByteStreamHandler(TOPIC_IMAGE, (reader, { identity }) => void this.onImage(reader, identity));
    room.registerTextStreamHandler(TOPIC_HISTORY, (reader, { identity }) => void this.onHistory(reader, identity));
  }

  dispose() {
    this.room.off(RoomEvent.Connected, this.requestHistory).off(RoomEvent.DataReceived, this.onData);
    this.room.unregisterByteStreamHandler(TOPIC_IMAGE);
    this.room.unregisterTextStreamHandler(TOPIC_HISTORY);
    for (const message of this.state.messages) revoke(message);
    this.listeners.clear();
    this.incomingListeners.clear();
  }

  /** For useSyncExternalStore. */
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  getSnapshot = () => this.state;

  /** Called for every message from someone else, history excluded. */
  onIncoming(listener: (message: ChatMessage) => void) {
    this.incomingListeners.add(listener);
    return () => void this.incomingListeners.delete(listener);
  }

  get isVisible() {
    return this.visible;
  }

  /** Whether the panel is open; opening it marks everything read. */
  setVisible(visible: boolean) {
    this.visible = visible;
    if (visible && this.state.unread) this.set({ ...this.state, unread: 0 });
  }

  async send(text: string, image?: Blob) {
    const local = this.room.localParticipant;
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      from: local.identity,
      name: nameOf(local),
      time: Date.now(),
      text: text.slice(0, MAX_TEXT),
      image: image && withUrl(image),
    };
    this.setMessages([...this.state.messages, message]);
    try {
      if (image) {
        await local.sendBytes(new Uint8Array(await image.arrayBuffer()), {
          topic: TOPIC_IMAGE,
          mimeType: image.type,
          name: "imagem",
          attributes: { id: message.id, text: message.text },
        });
      } else {
        await local.publishData(encoder.encode(JSON.stringify({ id: message.id, text: message.text })), {
          reliable: true,
          topic: TOPIC_TEXT,
        });
      }
    } catch {
      this.patch(message.id, { failed: true });
    }
  }

  private set(state: ChatState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  private setMessages(messages: ChatMessage[], unread = this.state.unread) {
    const dropped = messages.length - MAX_MESSAGES;
    if (dropped > 0) {
      messages.slice(0, dropped).forEach(revoke);
      messages = messages.slice(dropped);
    }
    this.set({ messages, unread });
  }

  private has(id: string) {
    return this.state.messages.some((m) => m.id === id);
  }

  /** Returns false when the message is gone (dropped for being too old). */
  private patch(id: string, changes: Partial<ChatMessage>): boolean {
    if (!this.has(id)) return false;
    this.set({ ...this.state, messages: this.state.messages.map((m) => (m.id === id ? { ...m, ...changes } : m)) });
    return true;
  }

  private receive(message: ChatMessage) {
    if (this.has(message.id)) return;
    this.setMessages([...this.state.messages, message], this.state.unread + (this.visible ? 0 : 1));
    for (const listener of this.incomingListeners) listener(message);
  }

  private onData = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
    if (topic !== TOPIC_SYNC && topic !== TOPIC_TEXT) return;
    const data = parse(decoder.decode(payload)) as { id?: unknown; text?: unknown; identity?: unknown } | null;
    // A newcomer asks before we've heard they joined (signalling and data travel separately), so
    // `participant` is still undefined here; the request names who to answer instead.
    if (topic === TOPIC_SYNC && typeof data?.identity === "string") return void this.sendHistory(data.identity);
    if (topic !== TOPIC_TEXT || !participant) return;
    if (typeof data?.id !== "string" || typeof data.text !== "string" || !data.text.trim()) return;
    this.receive({
      id: data.id,
      from: participant.identity,
      name: nameOf(participant),
      time: Date.now(),
      text: data.text.slice(0, MAX_TEXT),
    });
  };

  private async onImage(reader: ByteStreamReader, identity: string) {
    const { mimeType, size, attributes } = reader.info;
    const id = attributes?.id;
    if (!id || !IMAGE_TYPES.includes(mimeType) || (size ?? Infinity) > MAX_IMAGE_BYTES) return;
    const sender = this.room.getParticipantByIdentity(identity);
    // Shown right away so it keeps its place in the conversation while the bytes arrive.
    this.receive({
      id,
      from: identity,
      name: sender ? nameOf(sender) : identity,
      time: Date.now(),
      text: (attributes.text ?? "").slice(0, MAX_TEXT),
      image: "loading",
    });
    try {
      const blob = new Blob((await reader.readAll()) as Uint8Array<ArrayBuffer>[], { type: mimeType });
      if (blob.size > MAX_IMAGE_BYTES) throw new Error("too big");
      const image = withUrl(blob);
      if (!this.patch(id, { image })) URL.revokeObjectURL(image.url);
    } catch {
      this.patch(id, { image: "lost" });
    }
  }

  private requestHistory = () => {
    // Whoever has been here longest has seen the most.
    const [elder] = [...this.room.remoteParticipants.values()].sort(
      (a, b) => (a.joinedAt?.getTime() ?? Infinity) - (b.joinedAt?.getTime() ?? Infinity),
    );
    if (!elder) return;
    this.historyFrom = elder.identity;
    void this.room.localParticipant
      .publishData(encoder.encode(JSON.stringify({ identity: this.room.localParticipant.identity })), {
        reliable: true,
        topic: TOPIC_SYNC,
        destinationIdentities: [elder.identity],
      })
      .catch(() => undefined);
  };

  private async sendHistory(to: string) {
    const entries = await Promise.all(
      this.state.messages
        .filter((m) => !m.failed && (m.text || typeof m.image === "object"))
        .map(async ({ id, from, name, time, text, image }) => ({
          id,
          from,
          name,
          time,
          text,
          // Base64 inside one JSON keeps history atomic; "loading"/"lost" images go as text only.
          image: typeof image === "object" ? await toDataUrl(image.blob) : undefined,
        })),
    );
    if (!entries.length) return;
    await this.room.localParticipant
      .sendText(JSON.stringify(entries), { topic: TOPIC_HISTORY, destinationIdentities: [to] })
      .catch(() => undefined);
  }

  private async onHistory(reader: TextStreamReader, identity: string) {
    if (identity !== this.historyFrom || (reader.info.size ?? 0) > MAX_HISTORY_BYTES) return;
    this.historyFrom = null;
    const entries = parse(await reader.readAll().catch(() => ""));
    if (!Array.isArray(entries)) return;
    const older: ChatMessage[] = [];
    for (const entry of entries.slice(-MAX_MESSAGES)) {
      const { id, from, name, time, text, image } = (entry ?? {}) as Record<string, unknown>;
      if (typeof id !== "string" || typeof from !== "string" || typeof name !== "string") continue;
      if (typeof time !== "number" || typeof text !== "string" || this.has(id)) continue;
      const blob = fromDataUrl(image);
      if (!text && !blob) continue;
      older.push({ id, from, name, time, text: text.slice(0, MAX_TEXT), image: blob ? withUrl(blob) : undefined });
    }
    // Before anything that arrived while we waited.
    if (older.length) this.setMessages([...older, ...this.state.messages]);
  }
}

function revoke(message: ChatMessage) {
  if (typeof message.image === "object") URL.revokeObjectURL(message.image.url);
}
