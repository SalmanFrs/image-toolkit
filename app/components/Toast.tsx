"use client";

import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

export type ToastType = "loading" | "success" | "warning" | "error";

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  showToast: (type: ToastType, message: string, id?: string) => string;
  updateToast: (id: string, type: ToastType, message: string) => void;
  dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (type: ToastType, message: string, customId?: string): string => {
      const id = customId || `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      setToasts((prev) => {
        const existingIdx = prev.findIndex((t) => t.id === id);
        if (existingIdx !== -1) {
          const next = [...prev];
          next[existingIdx] = { id, type, message };
          return next;
        }
        return [...prev, { id, type, message }];
      });

      if (type !== "loading") {
        setTimeout(() => {
          dismissToast(id);
        }, 3500);
      }

      return id;
    },
    [dismissToast],
  );

  const updateToast = useCallback(
    (id: string, type: ToastType, message: string) => {
      setToasts((prev) =>
        prev.map((t) => (t.id === id ? { ...t, type, message } : t)),
      );

      if (type !== "loading") {
        setTimeout(() => {
          dismissToast(id);
        }, 3500);
      }
    },
    [dismissToast],
  );

  const contextValue = useMemo(
    () => ({
      showToast,
      updateToast,
      dismissToast,
    }),
    [showToast, updateToast, dismissToast],
  );

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      {/* Toast viewport */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2.5 sm:w-auto"
      >
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={() => dismissToast(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const config = useMemo(() => {
    switch (toast.type) {
      case "loading":
        return {
          border: "border-violet-500/30",
          bg: "bg-[#141521]",
          text: "text-violet-200",
          icon: (
            <svg
              className="h-4 w-4 animate-spin text-violet-400 shrink-0"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
              />
            </svg>
          ),
        };
      case "success":
        return {
          border: "border-emerald-500/30",
          bg: "bg-[#0f1d17]",
          text: "text-emerald-200",
          icon: (
            <svg
              className="h-4 w-4 text-emerald-400 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          ),
        };
      case "warning":
        return {
          border: "border-amber-500/30",
          bg: "bg-[#211b10]",
          text: "text-amber-200",
          icon: (
            <svg
              className="h-4 w-4 text-amber-400 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          ),
        };
      case "error":
        return {
          border: "border-red-500/30",
          bg: "bg-[#221215]",
          text: "text-red-200",
          icon: (
            <svg
              className="h-4 w-4 text-red-400 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ),
        };
    }
  }, [toast.type]);

  return (
    <div
      role="status"
      className={`pointer-events-auto flex items-center justify-between gap-3 rounded-xl border p-3.5 shadow-xl backdrop-blur-md transition-all ${config.border} ${config.bg} ${config.text}`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        {config.icon}
        <span className="text-xs font-medium leading-relaxed break-words">{toast.message}</span>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Close notification"
        className="ml-1 rounded-md p-1 text-gray-400 transition hover:bg-white/10 hover:text-white"
      >
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
