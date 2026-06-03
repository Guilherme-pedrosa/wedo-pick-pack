import { useCallback, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { UIMessage } from "ai";
import { Plus, MessageSquare, Trash2 } from "lucide-react";

import StockChatWindow from "@/components/estoque-ia/StockChatWindow";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import logo from "@/assets/estoque-ia-logo.png";

interface Thread {
  id: string;
  title: string;
}

const newId = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `t-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export default function EstoqueIAPage() {
  const navigate = useNavigate();
  const { threadId } = useParams<{ threadId: string }>();

  const [threads, setThreads] = useState<Thread[]>([]);
  const messagesStore = useRef<Map<string, UIMessage[]>>(new Map());

  // Ensure there is an active thread; create one if route has no/unknown id.
  const ensureActive = useCallback(() => {
    if (threadId && threads.some((t) => t.id === threadId)) return;
    const id = newId();
    setThreads((prev) => [{ id, title: "Nova conversa" }, ...prev]);
    navigate(`/estoque-ia/${id}`, { replace: !threadId });
  }, [threadId, threads, navigate]);

  // Lazily create the first thread on initial render.
  if (!threadId || !threads.some((t) => t.id === threadId)) {
    if (threads.length === 0 && !threadId) {
      // create initial thread synchronously via effect-like deferral
    }
    // run once
    queueMicrotask(ensureActive);
  }

  const startNew = () => {
    const id = newId();
    setThreads((prev) => [{ id, title: "Nova conversa" }, ...prev]);
    navigate(`/estoque-ia/${id}`);
  };

  const handleMessagesChange = useCallback((id: string, msgs: UIMessage[]) => {
    messagesStore.current.set(id, msgs);
  }, []);

  const handleTitle = useCallback((id: string, title: string) => {
    setThreads((prev) => prev.map((t) => (t.id === id ? { ...t, title } : t)));
  }, []);

  const deleteThread = (id: string) => {
    messagesStore.current.delete(id);
    setThreads((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (id === threadId) {
        if (next.length > 0) navigate(`/estoque-ia/${next[0].id}`, { replace: true });
        else navigate(`/estoque-ia`, { replace: true });
      }
      return next;
    });
  };

  const activeId = threadId && threads.some((t) => t.id === threadId) ? threadId : null;

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
                t.id === activeId ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50",
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
        {activeId ? (
          <StockChatWindow
            key={activeId}
            threadId={activeId}
            initialMessages={messagesStore.current.get(activeId) ?? []}
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
