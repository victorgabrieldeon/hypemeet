import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface Room {
  code: string;
  name: string;
  createdAt: number;
}

// No 0/O/1/I/L to keep codes easy to read aloud and type.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
export const NAME_MAX = 60;

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  let code = "";
  for (const b of bytes) code += ALPHABET[b % ALPHABET.length];
  return code;
}

export function openRoomStore(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run(`CREATE TABLE IF NOT EXISTS rooms (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);

  const insert = db.query<Room, { code: string; name: string; createdAt: number }>(
    "INSERT OR IGNORE INTO rooms (code, name, created_at) VALUES ($code, $name, $createdAt) RETURNING code, name, created_at AS createdAt",
  );
  const select = db.query<Room, { code: string }>(
    "SELECT code, name, created_at AS createdAt FROM rooms WHERE code = $code",
  );

  return {
    create(name: string): Room {
      // Collisions are astronomically rare (31^6 ≈ 887M), but INSERT OR IGNORE + retry keeps it correct.
      for (let attempt = 0; attempt < 8; attempt++) {
        const room = insert.get({ code: randomCode(), name, createdAt: Date.now() });
        if (room) return room;
      }
      throw new Error("could not allocate a room code");
    },
    get(code: string): Room | null {
      // Accept "abc-def", "ABC DEF", etc.
      return select.get({ code: code.toUpperCase().replace(/[^A-Z0-9]/g, "") });
    },
  };
}
