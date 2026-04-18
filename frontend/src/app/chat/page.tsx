"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { ChatWindow, type ChatWindowHandle } from "@/components/ChatWindow";
import { BrandMark } from "@/components/BrandMark";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UploadZone } from "@/components/UploadZone";
import { createClient } from "@/lib/client";
import {
  AUTH_CHECKING_SESSION,
  AUTH_REQUIRED_DESCRIPTION,
  AUTH_REQUIRED_TITLE,
  AUTH_STATE_ERROR,
  SIGN_OUT_ERROR,
  mapSupabaseAuthMessage,
} from "@/lib/messages";
import { CHAT_MODEL_OPTIONS, DEFAULT_CHAT_MODEL } from "@/lib/modelOptions";
import type { UploadResponse } from "@/types";

type UploadedDocument = {
  doc_id: string;
  name: string;
  chunks_count: number;
  created_at?: string;
};

const SESSION_DOCS_STORAGE_KEY = "baymax_uploaded_documents";
const ACTIVE_DOC_STORAGE_KEY = "baymax_active_document";
const CHAT_MODEL_STORAGE_KEY = "baymax_selected_model";

function formatUploadedTime(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

export default function ChatPage() {
  const router = useRouter();
  const chatRef = useRef<ChatWindowHandle>(null);
  const hasMountedModelNoticeRef = useRef(false);
  const [documents, setDocuments] = useState<UploadedDocument[]>([]);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_CHAT_MODEL);
  const [modelNotice, setModelNotice] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const backendUrl = process.env.NEXT_PUBLIC_API_URL as string | undefined;
  const mock = !backendUrl;
  const supabase = useMemo(() => createClient(), []);

  const activeDocument = documents.find((doc) => doc.doc_id === activeDocId) ?? null;
  const activeModelOption =
    CHAT_MODEL_OPTIONS.find((option) => option.id === selectedModel) ?? CHAT_MODEL_OPTIONS[1];

  const handleUploadComplete = (res: UploadResponse) => {
    const nextDoc: UploadedDocument = {
      doc_id: res.doc_id,
      name: res.name || `Tài liệu ${documents.length + 1}`,
      chunks_count: res.chunks_count,
      created_at: res.created_at,
    };

    setDocuments((prev) => {
      const existing = prev.filter((doc) => doc.doc_id !== nextDoc.doc_id);
      return [nextDoc, ...existing];
    });
    setActiveDocId(res.doc_id);
    chatRef.current?.clear();
  };

  const handleSelectDocument = (docId: string) => {
    setActiveDocId(docId);
    chatRef.current?.clear();
  };

  const handleRemoveDocument = (docId: string) => {
    setDocuments((prev) => {
      const nextDocs = prev.filter((doc) => doc.doc_id !== docId);
      if (activeDocId === docId) {
        setActiveDocId(nextDocs[0]?.doc_id ?? null);
        chatRef.current?.clear();
      }
      return nextDocs;
    });
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const rawDocs = window.localStorage.getItem(SESSION_DOCS_STORAGE_KEY);
      const rawActiveDoc = window.localStorage.getItem(ACTIVE_DOC_STORAGE_KEY);

      if (rawDocs) {
        const parsedDocs = JSON.parse(rawDocs) as UploadedDocument[];
        if (Array.isArray(parsedDocs)) {
          setDocuments(parsedDocs);
        }
      }

      if (rawActiveDoc) {
        setActiveDocId(rawActiveDoc);
      }

      const rawSelectedModel = window.localStorage.getItem(CHAT_MODEL_STORAGE_KEY);
      if (
        rawSelectedModel &&
        CHAT_MODEL_OPTIONS.some((option) => option.id === rawSelectedModel)
      ) {
        setSelectedModel(rawSelectedModel);
      }
    } catch {
      window.localStorage.removeItem(SESSION_DOCS_STORAGE_KEY);
      window.localStorage.removeItem(ACTIVE_DOC_STORAGE_KEY);
      window.localStorage.removeItem(CHAT_MODEL_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const bootstrapUser = async () => {
      const [{ data: userData, error: userError }, { data: sessionData }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.auth.getSession(),
      ]);
      if (!mounted) return;

      const sessionUser = sessionData.session?.user ?? null;
      const resolvedUser = userData.user ?? sessionUser;
      setUser(resolvedUser);
      setAccessToken(sessionData.session?.access_token ?? null);

      if (userError && !resolvedUser) {
        setAuthError(mapSupabaseAuthMessage(userError.message, AUTH_STATE_ERROR));
      }
      setAuthReady(true);
    };

    bootstrapUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAccessToken(session?.access_token ?? null);
      setAuthReady(true);
      if (!session?.user) {
        setDocuments([]);
        setActiveDocId(null);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SESSION_DOCS_STORAGE_KEY, JSON.stringify(documents));
  }, [documents]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (activeDocId) {
      window.localStorage.setItem(ACTIVE_DOC_STORAGE_KEY, activeDocId);
    } else {
      window.localStorage.removeItem(ACTIVE_DOC_STORAGE_KEY);
    }
  }, [activeDocId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(CHAT_MODEL_STORAGE_KEY, selectedModel);
  }, [selectedModel]);

  useEffect(() => {
    if (!authReady) return;
    if (!hasMountedModelNoticeRef.current) {
      hasMountedModelNoticeRef.current = true;
      return;
    }
    setModelNotice(`Đã chuyển sang model ${activeModelOption.label}.`);
    const timer = window.setTimeout(() => setModelNotice(null), 2200);
    return () => window.clearTimeout(timer);
  }, [selectedModel, activeModelOption.label, authReady]);

  useEffect(() => {
    if (documents.length === 0) {
      if (activeDocId !== null) {
        setActiveDocId(null);
      }
      return;
    }

    const hasActiveDocument = documents.some((doc) => doc.doc_id === activeDocId);
    if (!hasActiveDocument) {
      setActiveDocId(documents[0].doc_id);
    }
  }, [documents, activeDocId]);

  useEffect(() => {
    if (!profileMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) {
        setProfileMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [profileMenuOpen]);

  const handleSignOut = async () => {
    setProfileMenuOpen(false);
    setAuthLoading(true);
    setAuthError(null);
    const { error } = await supabase.auth.signOut();
    if (error) {
      setAuthError(mapSupabaseAuthMessage(error.message, SIGN_OUT_ERROR));
      setAuthLoading(false);
      return;
    }
    setDocuments([]);
    setActiveDocId(null);
    setAuthLoading(false);
    router.push("/");
    router.refresh();
  };

  const clearChat = () => {
    if (typeof window !== "undefined" && window.confirm("Bạn có chắc muốn xóa cuộc trò chuyện hiện tại?")) {
      chatRef.current?.clear();
    }
  };

  const exportChat = () => {
    chatRef.current?.exportTranscript();
  };

  const isAuthed = !!user && !!accessToken;
  const displayName =
    (user?.user_metadata?.full_name as string | undefined) ??
    (user?.user_metadata?.name as string | undefined) ??
    null;
  const avatarUrl =
    (user?.user_metadata?.avatar_url as string | undefined) ??
    (user?.user_metadata?.picture as string | undefined) ??
    null;
  const initials = (displayName || user?.email || "U").trim().charAt(0).toUpperCase();

  if (!authReady) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f7f7f4] text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-400">
        {AUTH_CHECKING_SESSION}
      </div>
    );
  }

  if (!isAuthed) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-[#f7f7f4] dark:bg-slate-900">
        <BrandMark />
        <h2 className="mt-6 text-xl font-semibold text-slate-900 dark:text-slate-100">
          {AUTH_REQUIRED_TITLE}
        </h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          {AUTH_REQUIRED_DESCRIPTION}
        </p>
        <div className="mt-6 flex gap-3">
          <Link
            href="/auth/login"
            className="rounded-lg bg-[#B22222] px-6 py-2.5 text-sm font-medium text-white transition hover:bg-[#9a1d1d]"
          >
            Đăng nhập
          </Link>
          <Link
            href="/"
            className="rounded-lg border border-slate-300 px-6 py-2.5 text-sm font-medium text-slate-700 transition hover:border-[#B22222] hover:text-[#B22222] dark:border-slate-600 dark:text-slate-300"
          >
            Về trang chủ
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#f7f7f4] dark:bg-slate-900">
      {authError && (
        <div className="shrink-0 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-300">
          {authError}
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        {sidebarOpen && (
          <button
            type="button"
            aria-label="Đóng sidebar"
            className="fixed inset-0 z-30 bg-black/40 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <aside
          className={`fixed inset-y-0 left-0 z-40 flex w-[300px] shrink-0 flex-col border-r border-[#B22222]/20 bg-slate-900 text-white transition-all duration-300 ease-out dark:bg-slate-950 md:static md:z-auto ${
            sidebarOpen
              ? "translate-x-0 md:w-[300px]"
              : "-translate-x-full md:w-0 md:translate-x-0 md:overflow-hidden md:border-0"
          }`}
        >
          <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-6">
            <div className="min-w-0">
              <BrandMark compact variant="onDark" />
            </div>
          </div>

          <div className="border-b border-white/10 px-5 py-4">
            <button
              type="button"
              onClick={() => chatRef.current?.clear()}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#B22222] px-4 py-3 text-sm font-medium text-white transition hover:bg-[#9a1d1d]"
            >
              Xóa cuộc trò chuyện
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            <div className="mb-3 px-2">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/40">
                Tài liệu đã tải lên
              </p>
              <p className="mt-1 text-xs text-white/50">
                {documents.length === 0
                  ? "Chưa có tài liệu nào trong phiên hiện tại."
                  : `${documents.length} tài liệu khả dụng để chat.`}
              </p>
            </div>

            <div className="space-y-2">
              {documents.length === 0 && (
                <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-4 text-sm text-white/60">
                  Tải lên một hoặc nhiều file PDF ở phần trên để bắt đầu.
                </div>
              )}

              {documents.map((doc) => {
                const isActive = doc.doc_id === activeDocId;
                const uploadedTime = formatUploadedTime(doc.created_at);
                return (
                  <div
                    key={doc.doc_id}
                    className={`rounded-xl border px-3 py-3 transition ${
                      isActive
                        ? "border-[#B22222] bg-[#B22222]/15 text-white"
                        : "border-white/10 bg-white/5 text-white/85 hover:bg-white/10"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        onClick={() => handleSelectDocument(doc.doc_id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="flex items-center gap-2">
                          <div className="truncate text-sm font-medium">{doc.name}</div>
                          {isActive && (
                            <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/90">
                              Đang chọn
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-white/60">
                          <span>{doc.chunks_count} chunks</span>
                          {uploadedTime && <span>Tải lúc {uploadedTime}</span>}
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveDocument(doc.doc_id)}
                        className="shrink-0 rounded-lg border border-white/10 px-2 py-1 text-xs text-white/70 transition hover:bg-white/10 hover:text-white"
                        aria-label={`Xóa tài liệu ${doc.name}`}
                        title="Xóa khỏi phiên hiện tại"
                      >
                        Xóa
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="shrink-0 border-t border-white/10 px-4 py-4">
            <div ref={profileMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setProfileMenuOpen((v) => !v)}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-white/10"
                aria-expanded={profileMenuOpen}
                aria-haspopup="true"
              >
                {avatarUrl ? (
                  <img src={avatarUrl} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
                ) : (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#B22222] to-[#7a1818] text-sm font-semibold text-white">
                    {initials}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{displayName || "Baymax user"}</div>
                  <div className="truncate text-xs text-white/50">{user?.email}</div>
                </div>
              </button>
              {profileMenuOpen && (
                <div
                  className="absolute bottom-full left-0 right-0 z-50 mb-2 space-y-2 rounded-lg border border-white/15 bg-slate-800 p-2 shadow-xl"
                  role="menu"
                >
                  <ThemeToggle className="w-full justify-center border-white/20 bg-white/5 text-white hover:bg-white/10 dark:border-white/20 dark:bg-white/5 dark:text-white dark:hover:bg-white/10" />
                  <Link
                    href="/"
                    className="flex w-full items-center rounded-lg px-3 py-2 text-sm font-medium text-white transition hover:bg-white/10"
                    role="menuitem"
                  >
                    Trang chủ
                  </Link>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={handleSignOut}
                    disabled={authLoading}
                    className="w-full rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm font-medium text-white transition hover:bg-white/10 disabled:opacity-50"
                  >
                    {authLoading ? "Đang xử lý..." : "Đăng xuất"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-white dark:bg-slate-900">
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setSidebarOpen((v) => !v)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-600 transition hover:bg-[#f7f7f4] hover:text-[#B22222] dark:text-slate-300 dark:hover:bg-slate-800"
                aria-label="Ẩn hiện sidebar"
              >
                <span className="text-xl">|||</span>
              </button>
              <div className="min-w-0">
                <h1 className="truncate text-lg font-semibold text-slate-900 dark:text-slate-100">
                  Tóm tắt và hỏi đáp tài liệu
                </h1>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                  {activeDocument
                    ? `Đang chat với: ${activeDocument.name}`
                    : "Hãy chọn một tài liệu để bắt đầu chat."}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <div className="hidden min-w-[220px] sm:block">
                <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 dark:border-slate-600 dark:text-slate-300">
                  <span>Mô hình</span>
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                >
                  {CHAT_MODEL_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id} className="text-slate-900">
                      {option.label} - {option.shortName}
                    </option>
                  ))}
                </select>
              </label>
                <p className="mt-1 px-1 text-xs text-slate-500 dark:text-slate-400">
                  {activeModelOption.label} - {activeModelOption.shortName}: {activeModelOption.description}
                </p>
              </div>
              <button
                type="button"
                onClick={clearChat}
                className="hidden items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 transition hover:border-[#B22222]/40 hover:bg-[#f7f7f4] hover:text-[#B22222] sm:inline-flex dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Xóa chat
              </button>
              <button
                type="button"
                onClick={exportChat}
                className="hidden items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 transition hover:border-[#B22222]/40 hover:bg-[#f7f7f4] hover:text-[#B22222] sm:inline-flex dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Xuất file
              </button>
            </div>
          </header>

          {modelNotice && (
            <div className="shrink-0 border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-300">
              {modelNotice}
            </div>
          )}

          <section className="shrink-0 border-b border-slate-200 bg-[#f7f7f4] px-4 py-5 dark:border-slate-700 dark:bg-slate-900/50">
            <div className="mx-auto w-full max-w-[900px]">
              <div className="mb-3 text-sm text-slate-600 dark:text-slate-300">
                Bạn có thể tải thêm nhiều file PDF. Mỗi lần chat sẽ dùng tài liệu đang được chọn ở thanh bên trái.
              </div>
              <div className="mb-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                <span className="font-medium">Mô hình hiện tại:</span> {activeModelOption.label}
                {" · "}
                {activeModelOption.shortName}: {activeModelOption.description}
              </div>
              <div className="h-[104px] w-full">
                <UploadZone
                  onUploadComplete={handleUploadComplete}
                  mock={mock}
                  accessToken={accessToken}
                  compact
                />
              </div>
            </div>
          </section>

          <div className="flex min-h-0 flex-1 flex-col">
            <ChatWindow
              ref={chatRef}
              docId={activeDocId}
              mock={mock}
              accessToken={accessToken}
              selectedModel={selectedModel}
            />
          </div>
        </main>
      </div>

      <footer className="shrink-0 border-t border-slate-200 py-1.5 text-center text-[10px] text-slate-500 dark:border-slate-700 dark:text-slate-500">
        {mock ? "Chưa kết nối backend - chế độ demo" : "Đã kết nối backend"}
      </footer>
    </div>
  );
}
