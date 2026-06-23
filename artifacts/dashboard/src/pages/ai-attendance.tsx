import { useState, useRef, useEffect } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { Send, Bot, User, Loader2, Sparkles, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Message {
  role: "user" | "assistant";
  content: string;
  error?: boolean;
}

// ─── Suggested questions ──────────────────────────────────────────────────────

const SUGGESTIONS = [
  "Кои работници са в отпуска днес?",
  "Колко болнични са взети общо?",
  "Дай обобщение на отпуските по отдели",
  "Колко отказани достъпа има за последните 30 дни?",
  "Кой отдел има най-много работници?",
  "Кои работници са в командировка?",
];

// ─── Message bubble ────────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  return (
    <div className={cn("flex gap-3 items-start", isUser && "flex-row-reverse")}>
      <div className={cn(
        "shrink-0 w-8 h-8 rounded-full flex items-center justify-center",
        isUser ? "bg-primary/20 text-primary" : "bg-yellow-500/20 text-yellow-400"
      )}>
        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
      </div>
      <div className={cn(
        "max-w-[80%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed",
        isUser
          ? "bg-primary text-primary-foreground rounded-tr-none"
          : msg.error
            ? "bg-red-500/10 border border-red-500/20 text-red-400 rounded-tl-none"
            : "bg-card border border-border text-foreground rounded-tl-none"
      )}>
        {msg.content}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AiAttendancePage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function sendMessage(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;

    const userMsg: Message = { role: "user", content: msg };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setLoading(true);

    try {
      const token = localStorage.getItem("access_token") ?? "";
      const res = await fetch("/api/ai-attendance/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: msg,
          history: next.slice(-10).map(m => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Неизвестна грешка" }));
        setMessages(prev => [...prev, {
          role: "assistant",
          content: err.detail ?? "Грешка при свързване с AI",
          error: true,
        }]);
        return;
      }

      const data = await res.json() as { reply: string; tokens?: number };
      setMessages(prev => [...prev, { role: "assistant", content: data.reply }]);
    } catch {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: "Неуспешно свързване с AI. Проверете конфигурацията на OPENAI_API_KEY.",
        error: true,
      }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function clearChat() {
    setMessages([]);
    setInput("");
    inputRef.current?.focus();
  }

  const isEmpty = messages.length === 0;

  return (
    <AppLayout>
      <div className="flex flex-col h-[calc(100vh-4rem)]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-yellow-500/20 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-yellow-400" />
            </div>
            <div>
              <h1 className="font-bold text-lg">{t("aiAttendance.title")}</h1>
              <p className="text-xs text-muted-foreground">{t("aiAttendance.subtitle")}</p>
            </div>
          </div>
          {!isEmpty && (
            <Button variant="ghost" size="sm" onClick={clearChat} className="gap-2 text-muted-foreground">
              <RefreshCw className="w-3.5 h-3.5" />
              {t("aiAttendance.newChat")}
            </Button>
          )}
        </div>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
          {isEmpty ? (
            /* Welcome state */
            <div className="flex flex-col items-center justify-center h-full gap-6 text-center">
              <div className="w-16 h-16 rounded-2xl bg-yellow-500/20 flex items-center justify-center">
                <Bot className="w-8 h-8 text-yellow-400" />
              </div>
              <div>
                <h2 className="text-xl font-semibold mb-1">{t("aiAttendance.welcome")}</h2>
                <p className="text-sm text-muted-foreground max-w-sm">{t("aiAttendance.welcomeDesc")}</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => sendMessage(s)}
                    className="text-left text-sm px-4 py-3 rounded-xl border border-border bg-card hover:bg-muted/40 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((m, i) => (
                <MessageBubble key={i} msg={m} />
              ))}
              {loading && (
                <div className="flex gap-3 items-start">
                  <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-yellow-500/20 text-yellow-400">
                    <Bot className="w-4 h-4" />
                  </div>
                  <div className="bg-card border border-border rounded-2xl rounded-tl-none px-4 py-3">
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  </div>
                </div>
              )}
            </>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        <div className="px-6 py-4 border-t border-border bg-background shrink-0">
          <div className="flex gap-3 max-w-3xl mx-auto">
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder={t("aiAttendance.placeholder")}
              disabled={loading}
              className="flex-1"
            />
            <Button onClick={() => sendMessage()} disabled={!input.trim() || loading} size="icon">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
          <p className="text-center text-[10px] text-muted-foreground mt-2">
            {t("aiAttendance.disclaimer")}
          </p>
        </div>
      </div>
    </AppLayout>
  );
}
