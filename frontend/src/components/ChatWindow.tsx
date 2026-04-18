"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { streamChatSSEParser } from "@/lib/api";
import {
  AUTH_SESSION_REQUIRED,
  BACKEND_CONNECTION_ERROR,
  CHAT_DOCUMENT_REQUIRED,
  GENERIC_CHAT_ERROR,
  sanitizeUserMessage,
} from "@/lib/messages";
import type { ChatMessage } from "@/types";
import { StreamingCursor } from "./StreamingCursor";

export type ChatWindowHandle = {
  clear: () => void;
  exportTranscript: () => void;
};

interface ChatWindowProps {
  docId: string | null;
  mock?: boolean;
  accessToken?: string | null;
  selectedModel?: string;
}

function genId() {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const ChatWindow = forwardRef<ChatWindowHandle, ChatWindowProps>(
  function ChatWindow({ docId, mock = true, accessToken, selectedModel }, ref) {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }, [messages]);

    useImperativeHandle(
      ref,
      () => ({
        clear: () => {
          setMessages([]);
          setError(null);
        },
        exportTranscript: () => {
          const lines: string[] = ["=== LỊCH SỬ CHAT ===", ""];
          messages.forEach((m) => {
            const who = m.role === "user" ? "Bạn" : "AI";
            lines.push(`[${who}]`, m.content, "");
          });
          const blob = new Blob([lines.join("\n")], {
            type: "text/plain;charset=utf-8",
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `chat-${new Date().toISOString().split("T")[0]}.txt`;
          a.click();
          URL.revokeObjectURL(url);
        },
      }),
      [messages]
    );

    const appendToken = useCallback((messageId: string, token: string) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, content: m.content + token } : m))
      );
    }, []);

    const finishStreaming = useCallback((messageId: string) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, isStreaming: false } : m))
      );
    }, []);

    const handleSubmit = useCallback(
      async (e: React.FormEvent) => {
        e.preventDefault();
        const q = input.trim();
        if (!q || loading) return;
        if (!docId && !mock) {
          setError(CHAT_DOCUMENT_REQUIRED);
          return;
        }

        setError(null);
        setInput("");
        const userMsg: ChatMessage = {
          id: genId(),
          role: "user",
          content: q,
        };
        setMessages((prev) => [...prev, userMsg]);

        const assistantId = genId();
        const assistantMsg: ChatMessage = {
          id: assistantId,
          role: "assistant",
          content: "",
          isStreaming: true,
        };
        setMessages((prev) => [...prev, assistantMsg]);
        setLoading(true);

        if (mock) {
          const mockText =
            "Đây là câu trả lời mẫu dựa trên nội dung tài liệu ở chế độ mock. Khi kết nối backend, câu trả lời sẽ được stream từng token.";
          for (let i = 0; i < mockText.length; i += 1) {
            await new Promise((resolve) => setTimeout(resolve, 20));
            appendToken(assistantId, mockText[i]);
          }
          finishStreaming(assistantId);
          setLoading(false);
          return;
        }

        try {
          const { streamChat } = await import("@/lib/api");
          if (!accessToken) {
            setError(AUTH_SESSION_REQUIRED);
            finishStreaming(assistantId);
            setLoading(false);
            return;
          }
          const res = await streamChat(q, docId!, selectedModel, accessToken);
          if (!res || !res.body) {
            setError(BACKEND_CONNECTION_ERROR);
            finishStreaming(assistantId);
            setLoading(false);
            return;
          }

          for await (const event of streamChatSSEParser(res.body)) {
            if (event.type === "sources") continue;
            if (event.type === "token") appendToken(assistantId, event.data);
            if (event.type === "error") {
              setError(sanitizeUserMessage(event.data.message, GENERIC_CHAT_ERROR));
            }
            if (event.type === "done") break;
          }
          finishStreaming(assistantId);
        } catch (err) {
          setError(
            sanitizeUserMessage(
              err instanceof Error ? err.message : "",
              GENERIC_CHAT_ERROR
            )
          );
          finishStreaming(assistantId);
        } finally {
          setLoading(false);
        }
      },
      [accessToken, appendToken, docId, finishStreaming, input, loading, mock, selectedModel]
    );

    const isEmpty = messages.length === 0;
    const hasDoc = !!docId || mock;

    return (
      <div className="flex h-full min-h-0 flex-col bg-white">
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
          {isEmpty && (
            <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 text-center text-slate-500 dark:text-slate-400">
              {!hasDoc ? (
                <>
                  <p>Chưa có tài liệu nào.</p>
                  <p className="text-sm">Tải lên PDF ở trên để bắt đầu hỏi đáp.</p>
                </>
              ) : (
                <>
                  <p>Chưa có tin nhắn.</p>
                  <p className="text-sm">Nhập câu hỏi và nhấn Gửi.</p>
                </>
              )}
            </div>
          )}

          {!isEmpty && (
            <ul className="space-y-4">
              {messages.map((m) => (
                <li
                  key={m.id}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2 shadow-sm ${
                      m.role === "user"
                        ? "bg-[#B22222] text-white"
                        : "bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-200"
                    }`}
                  >
                    <div className="whitespace-pre-wrap break-words">
                      {m.content}
                      {m.isStreaming && <StreamingCursor />}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {error && (
            <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
              {error}
            </div>
          )}
        </div>

        <form
          onSubmit={handleSubmit}
          className="shrink-0 border-t border-slate-200 bg-white p-4 dark:border-slate-700 md:px-6"
        >
          <div className="flex gap-3 rounded-2xl border border-slate-200 bg-[#f7f7f4] p-3 focus-within:border-[#B22222]/50 focus-within:ring-2 focus-within:ring-[#B22222]/15">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (!loading && input.trim()) {
                    e.currentTarget.form?.requestSubmit();
                  }
                }
              }}
              placeholder="Nhập câu hỏi của bạn..."
              rows={1}
              className="max-h-36 min-h-[44px] flex-1 resize-none border-0 bg-transparent px-2 py-2 text-slate-900 placeholder-slate-400 focus:outline-none dark:text-slate-100"
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#B22222] text-white hover:bg-[#9a1d1d] disabled:opacity-40"
              aria-label="Gửi"
            >
              {loading ? "..." : "->"}
            </button>
          </div>
        </form>
      </div>
    );
  }
);

ChatWindow.displayName = "ChatWindow";
