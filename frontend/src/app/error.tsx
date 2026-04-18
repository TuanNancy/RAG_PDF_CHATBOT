"use client";

import { useEffect } from "react";

const FALLBACK_ERROR_MESSAGE = "Đã xảy ra lỗi không mong muốn. Vui lòng thử lại.";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 p-4 dark:bg-slate-900">
      <h2 className="text-lg font-medium text-slate-800 dark:text-slate-100">
        Đã có lỗi xảy ra
      </h2>
      <p className="max-w-md text-center text-sm text-slate-600 dark:text-slate-400">
        {FALLBACK_ERROR_MESSAGE}
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
      >
        Thử lại
      </button>
    </div>
  );
}
