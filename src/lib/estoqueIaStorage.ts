import type { UIMessage } from "ai";

export interface StoredThread {
  id: string;
  title: string;
  updatedAt: number;
  messages: UIMessage[];
}

const KEY = "estoque-ia-threads-v1";

export const newThreadId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `t-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function loadThreads(): StoredThread[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t) => t && typeof t.id === "string")
      .map((t) => ({
        id: t.id,
        title: typeof t.title === "string" ? t.title : "Nova conversa",
        updatedAt: typeof t.updatedAt === "number" ? t.updatedAt : Date.now(),
        messages: Array.isArray(t.messages) ? (t.messages as UIMessage[]) : [],
      }));
  } catch {
    return [];
  }
}

export function saveThreads(threads: StoredThread[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(threads));
  } catch {
    // ignore quota / serialization errors
  }
}
