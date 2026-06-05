import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { UIMessage } from "ai";
import { Plus, MessageSquare, Trash2 } from "lucide-react";

import StockChatWindow from "@/components/estoque-ia/StockChatWindow";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import logo from "@/assets/estoque-ia-logo.png";
import {
  loadThreads,
  newThreadId,
  saveThreads,
  type StoredThread,
} from "@/lib/estoqueIaStorage";

// Idempotent, client-safe bootstrap: read localStorage and create a default
// thread only when none exist. Runs once at module-load of this component.
function bootstrap(): StoredThread[] {
  const existing = loadThreads();
  if (existing.length > 0) return existing;
  const initial: StoredThread = {
    id: newThreadId(),
    title: "Nova conversa",
    updatedAt: Date.now(),
    messages: [],
  };
  saveThreads([initial]);
  return [initial];
}

export default function EstoqueIAPage() {
  const navigate = useNavigate();
  const { threadId } = useParams<{ threadId: string }>();

  const [threads, setThreads] = useState<StoredThread[]>(() => bootstrap());

  // Persist threads (with messages) whenever they change.
  useEffect(() => {
    saveThreads(threads);
  }, [threads]);

  // Ensure the route points at a valid thread.
  useEffect(() => {
    if (threadId && threads.some((t) => t.id === threadId)) return;
    if (threads.length > 0) {
      navigate(`/estoque-ia/${threads[0].id}`, { replace: true });
    }
  }, [threadId, threads, navigate]);

  const startNew = () => {
    const id = newThreadId();
    setThreads((prev) => [
      { id, title: "Nova conversa", updatedAt: Date.now(), messages: [] },
      ...prev,
    ]);
    navigate(`/estoque-ia/${id}`);
  };

  const handleMessagesChange = useCallback((id: string, msgs: UIMessage[]) => {
    setThreads((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, messages: msgs, updatedAt: Date.now() } : t,
      ),
    );
  }, []);

  const handleTitle = useCallback((id: string, title: string) => {
    setThreads((prev) => prev.map((t) => (t.id === id ? { ...t, title } : t)));
  }, []);

  const deleteThread = (id: string) => {
    setThreads((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (id === threadId) {
        if (next.length > 0) navigate(`/estoque-ia/${next[0].id}`, { replace: true });
        else navigate(`/estoque-ia`, { replace: true });
      }
      return next;
    });
  };

  const activeThread =
    (threadId && threads.find((t) => t.id === threadId)) || null;

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* Thread sidebar */}
      <aside className="hidden w-64 flex-col border-r border-border bg-card/40 md:flex">
        <div className="flex items-center gap-2 border-b border-border p-3">
          <img src={logo} alt="IA de Estoque" width={32} height={32} className="rounded-full" />
          <span className="text-sm font-semibold">IA de Estoque</span>
        </div>
        <div className="p-3">
          <Button onClick={startNew} className="w-full justify-start gap-2" size="sm">
            <Plus className="size-4" /> Nova conversa
          </Button>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-2 pb-3">
          {threads.map((t) => (
            <div
              key={t.id}
              className={cn(
                "group flex items-center gap-2 rounded-md px-2 py-2 text-sm",
                t.id === activeThread?.id
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/50",
              )}
            >
              <button
                onClick={() => navigate(`/estoque-ia/${t.id}`)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <MessageSquare className="size-4 shrink-0" />
                <span className="truncate">{t.title}</span>
              </button>
              <button
                onClick={() => deleteThread(t.id)}
                className="opacity-0 transition-opacity group-hover:opacity-100"
                aria-label="Excluir conversa"
              >
                <Trash2 className="size-4 text-muted-foreground hover:text-destructive" />
              </button>
            </div>
          ))}
        </nav>
      </aside>

      {/* Chat */}
      <main className="flex-1 overflow-hidden">
        {activeThread ? (
          <StockChatWindow
            key={activeThread.id}
            threadId={activeThread.id}
            initialMessages={activeThread.messages}
            onMessagesChange={handleMessagesChange}
            onTitle={handleTitle}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            Carregando conversa...
          </div>
        )}
      </main>
    </div>
  );
}
