import { useEffect, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { toast } from "sonner";
import { Package, Send, Square } from "lucide-react";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Tool, ToolHeader, ToolContent, ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import logo from "@/assets/estoque-ia-logo.png";

const ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/estoque-ai-chat`;
const ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

interface Props {
  threadId: string;
  initialMessages: UIMessage[];
  onMessagesChange: (id: string, messages: UIMessage[]) => void;
  onTitle: (id: string, title: string) => void;
}

const SUGGESTIONS = [
  "Quantas peças tenho da bomba?",
  "Qual o saldo do código 1234?",
  "Onde fica a peça (tabela/prateleira)?",
];

export default function StockChatWindow({ threadId, initialMessages, onMessagesChange, onTitle }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const titledRef = useRef(false);

  const { messages, sendMessage, status, stop } = useChat({
    id: threadId,
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: ENDPOINT,
      headers: { Authorization: `Bearer ${ANON}`, apikey: ANON },
    }),
    onError: (err) => toast.error(err.message || "Erro ao falar com a IA de estoque"),
  });

  const isLoading = status === "submitted" || status === "streaming";

  // Lift messages into the parent (in-memory thread store)
  useEffect(() => {
    onMessagesChange(threadId, messages);
    if (!titledRef.current) {
      const firstUser = messages.find((m) => m.role === "user");
      if (firstUser) {
        const txt = firstUser.parts
          .map((p) => (p.type === "text" ? p.text : ""))
          .join(" ")
          .trim();
        if (txt) {
          onTitle(threadId, txt.slice(0, 40));
          titledRef.current = true;
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, threadId]);

  // Keep textarea focused
  useEffect(() => {
    textareaRef.current?.focus();
  }, [threadId, status]);

  const handleSubmit = (msg: { text?: string }) => {
    const text = (msg.text ?? "").trim();
    if (!text || isLoading) return;
    sendMessage({ text });
  };

  const send = (text: string) => {
    if (isLoading) return;
    sendMessage({ text });
  };

  return (
    <div className="flex h-full flex-col">
      <Conversation>
        <ConversationContent>
          {messages.length === 0 ? (
            <ConversationEmptyState
              icon={<img src={logo} alt="IA de Estoque" width={64} height={64} className="rounded-full" />}
              title="IA Especialista de Estoque"
              description="Pergunte sobre saldo de peças, preço e localização (tabela/prateleira)."
            >
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-full border border-border bg-muted/40 px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-muted"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </ConversationEmptyState>
          ) : (
            messages.map((message) => (
              <Message from={message.role} key={message.id}>
                <MessageContent>
                  {message.parts.map((part, i) => {
                    if (part.type === "text") {
                      return <MessageResponse key={i}>{part.text}</MessageResponse>;
                    }
                    if (part.type === "tool-consultar_estoque" || part.type === "dynamic-tool") {
                      const p = part as any;
                      return (
                        <Tool key={i} defaultOpen={false}>
                          <ToolHeader
                            type={p.type}
                            state={p.state}
                            toolName={p.toolName ?? "consultar_estoque"}
                            title="Consultando o estoque"
                          />
                          <ToolContent>
                            {p.input ? <ToolInput input={p.input} /> : null}
                            {p.state === "output-available" || p.state === "output-error" ? (
                              <ToolOutput output={p.output} errorText={p.errorText} />
                            ) : null}
                          </ToolContent>
                        </Tool>
                      );
                    }
                    return null;
                  })}
                </MessageContent>
              </Message>
            ))
          )}
          {status === "submitted" && (
            <Message from="assistant">
              <MessageContent>
                <div className="flex items-center gap-2 text-sm">
                  <Package className="size-4" />
                  <Shimmer>Consultando estoque...</Shimmer>
                </div>
              </MessageContent>
            </Message>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="border-t border-border p-3">
        <PromptInput onSubmit={handleSubmit}>
          <PromptInputTextarea ref={textareaRef} placeholder="Pergunte sobre uma peça do estoque..." />
          <PromptInputFooter className="justify-end">
            {isLoading ? (
              <PromptInputSubmit status={status} onClick={() => stop()}>
                <Square className="size-4" />
              </PromptInputSubmit>
            ) : (
              <PromptInputSubmit status={status}>
                <Send className="size-4" />
              </PromptInputSubmit>
            )}
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}
