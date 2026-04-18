"use client";

import { useCallback, useState } from "react";
import { uploadPDF } from "@/lib/api";
import {
  AUTH_SESSION_REQUIRED,
  BACKEND_CONNECTION_ERROR,
  GENERIC_UPLOAD_ERROR,
  PDF_REQUIRED_ERROR,
  sanitizeUserMessage,
} from "@/lib/messages";
import type { UploadResponse } from "@/types";

type Status = "idle" | "dragging" | "uploading" | "success" | "error";

interface UploadZoneProps {
  onUploadComplete?: (res: UploadResponse) => void;
  mock?: boolean;
  accessToken?: string | null;
  compact?: boolean;
}

export function UploadZone({
  onUploadComplete,
  mock = true,
  accessToken,
  compact = false,
}: UploadZoneProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<UploadResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);

  const isAcceptedPdf = useCallback((file: File) => {
    const type = (file.type || "").toLowerCase();
    const name = (file.name || "").toLowerCase();
    return (
      name.endsWith(".pdf") ||
      type === "application/pdf" ||
      type === "application/x-pdf" ||
      type === "application/acrobat" ||
      type === "applications/vnd.pdf" ||
      type === "text/pdf" ||
      type === "text/x-pdf"
    );
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setStatus("dragging");
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setStatus("idle");
  }, []);

  const simulateUpload = useCallback(
    (file: File) => {
      setStatus("uploading");
      setError(null);
      setResult(null);
      setFilename(file.name);
      setProgress(0);
      const step = 100 / 20;
      let n = 0;
      const timer = setInterval(() => {
        n += 1;
        setProgress(Math.min(n * step, 100));
        if (n >= 20) {
          clearInterval(timer);
          const res: UploadResponse = {
            doc_id: `mock-${Date.now()}`,
            chunks_count: Math.max(3, Math.floor(Math.random() * 15)),
            message: "Tải lên và index thành công (mock).",
          };
          setResult(res);
          setStatus("success");
          onUploadComplete?.(res);
        }
      }, 120);
    },
    [onUploadComplete]
  );

  const uploadToBackend = useCallback(
    async (file: File) => {
      setStatus("uploading");
      setError(null);
      setResult(null);
      setFilename(file.name);
      setProgress(30);

      try {
        if (!accessToken) {
          throw new Error(AUTH_SESSION_REQUIRED);
        }
        const res = await uploadPDF(file, accessToken);
        if (!res) {
          throw new Error(BACKEND_CONNECTION_ERROR);
        }

        setResult(res);
        setProgress(100);
        setStatus("success");
        onUploadComplete?.(res);
      } catch (err) {
        setError(
          sanitizeUserMessage(
            err instanceof Error ? err.message : "",
            GENERIC_UPLOAD_ERROR
          )
        );
        setStatus("error");
      }
    },
    [accessToken, onUploadComplete]
  );

  const handleIncomingFile = useCallback(
    async (file: File) => {
      if (!isAcceptedPdf(file)) {
        setError(PDF_REQUIRED_ERROR);
        setStatus("error");
        return;
      }

      if (mock) {
        simulateUpload(file);
      } else {
        await uploadToBackend(file);
      }
    },
    [isAcceptedPdf, mock, simulateUpload, uploadToBackend]
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setStatus("idle");
      const file = e.dataTransfer.files?.[0];
      if (!file) return;
      await handleIncomingFile(file);
    },
    [handleIncomingFile]
  );

  const handleFileInput = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      await handleIncomingFile(file);
      e.target.value = "";
    },
    [handleIncomingFile]
  );

  const isActive = status === "dragging" || status === "uploading";

  return (
    <div
      className={`h-full rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 transition-colors dark:border-slate-600 dark:bg-slate-800/50 ${
        compact ? "p-3" : "p-6"
      }`}
    >
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`flex h-full flex-col items-center justify-center gap-2 rounded-lg transition-colors ${
          isActive ? "bg-blue-50 dark:bg-blue-950/30" : ""
        }`}
      >
        {status === "idle" && (
          <>
              <p className="text-center text-slate-600 dark:text-slate-400">
              Kéo thả file PDF vào đây hoặc nhấn để chọn file
            </p>
            <label className="cursor-pointer rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600">
              Chọn file
              <input
                type="file"
                accept="application/pdf"
                className="sr-only"
                onChange={handleFileInput}
              />
            </label>
          </>
        )}

        {status === "dragging" && (
          <p className="text-blue-600 dark:text-blue-400">Thả file để tải lên</p>
        )}

        {status === "uploading" && (
          <div className="w-full max-w-xs space-y-2">
            <p className="text-center text-sm text-slate-600 dark:text-slate-400">
              Đang xử lý: {filename}
            </p>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div
                className="h-full rounded-full bg-blue-600 transition-all duration-300 dark:bg-blue-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-center text-xs text-slate-500">{progress}%</p>
          </div>
        )}

        {status === "success" && result && (
          <div className="w-full space-y-2 text-center">
            <p className="text-sm font-medium text-green-700 dark:text-green-400">
              Tải lên thành công
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              File: <span className="font-medium">{filename}</span>
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Số chunks: <span className="font-medium">{result.chunks_count}</span>
            </p>
            {result.message && (
              <p className="text-xs text-slate-500">{result.message}</p>
            )}
            {result.status && !result.message && (
              <p className="text-xs text-slate-500">
                Trạng thái: <span className="font-medium">{result.status}</span>
              </p>
            )}
            {typeof result.processing_time === "number" && (
              <p className="text-xs text-slate-500">
                Thời gian: <span className="font-medium">{result.processing_time}s</span>
              </p>
            )}
            {result.pdf_storage_key && (
              <p className="text-xs text-green-600 dark:text-green-400">
                Đã lưu file gốc lên storage:{" "}
                <span className="font-medium">{result.pdf_storage_key}</span>
              </p>
            )}
            {result.warnings && result.warnings.length > 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Cảnh báo: {result.warnings[0]}
              </p>
            )}
          </div>
        )}

        {status === "error" && (
          <div className="space-y-2 text-center">
            <p className="text-sm font-medium text-red-600 dark:text-red-400">Lỗi</p>
            <p className="text-sm text-slate-600 dark:text-slate-400">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}
