'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
} from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ToastVariant = 'success' | 'error' | 'info'

export interface Toast {
  id: string
  message: string
  variant: ToastVariant
  /** true while the toast is animating out */
  dismissing: boolean
}

type Action =
  | { type: 'ADD'; toast: Toast }
  | { type: 'DISMISS'; id: string }
  | { type: 'REMOVE'; id: string }

// ─── Reducer ──────────────────────────────────────────────────────────────────

const MAX_TOASTS = 4

function reducer(state: Toast[], action: Action): Toast[] {
  switch (action.type) {
    case 'ADD': {
      const next = [...state, action.toast]
      // If over cap, start dismissing the oldest
      if (next.length > MAX_TOASTS) {
        next[0] = { ...next[0], dismissing: true }
      }
      return next
    }
    case 'DISMISS':
      return state.map((t) =>
        t.id === action.id ? { ...t, dismissing: true } : t
      )
    case 'REMOVE':
      return state.filter((t) => t.id !== action.id)
    default:
      return state
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface ToastContextValue {
  dispatch: React.Dispatch<Action>
}

const ToastContext = createContext<ToastContextValue | null>(null)

// ─── External controller (module-level) ──────────────────────────────────────
// This is populated by ToastProvider so that toast.ts can call it from anywhere.

type AddToastFn = (message: string, variant: ToastVariant) => void

let _addToast: AddToastFn | null = null

/** Called by the module-level toast controller in lib/toast.ts */
export function _registerToastController(fn: AddToastFn) {
  _addToast = fn
}

export function _unregisterToastController() {
  _addToast = null
}

/** Used internally and exported for lib/toast.ts */
export function addToast(message: string, variant: ToastVariant) {
  _addToast?.(message, variant)
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')

  const add = useCallback(
    (message: string, variant: ToastVariant) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      ctx.dispatch({ type: 'ADD', toast: { id, message, variant, dismissing: false } })
      // Auto-dismiss after 4 s
      setTimeout(() => ctx.dispatch({ type: 'DISMISS', id }), 4000)
    },
    [ctx]
  )

  return {
    toast: {
      success: (msg: string) => add(msg, 'success'),
      error: (msg: string) => add(msg, 'error'),
      info: (msg: string) => add(msg, 'info'),
    },
  }
}

// ─── Single toast item ────────────────────────────────────────────────────────

const variantStyles: Record<ToastVariant, string> = {
  success: 'border-l-4 border-l-green-500',
  error: 'border-l-4 border-l-red-500',
  info: 'border-l-4 border-l-[--accent]',
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast
  onDismiss: (id: string) => void
}) {
  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn(
        // Base
        'relative flex items-start gap-3 min-w-[280px] max-w-[360px]',
        'bg-[--bg-overlay] border border-[--border] rounded-[--radius-lg] p-3 shadow-[--shadow]',
        // Variant accent
        variantStyles[toast.variant],
        // Animate in: slide from right + fade in
        'transition-all duration-300 ease-out',
        toast.dismissing
          ? 'opacity-0 translate-x-6 pointer-events-none'
          : 'opacity-100 translate-x-0',
      )}
    >
      <p className="flex-1 text-sm text-[--text-primary] leading-snug break-words">
        {toast.message}
      </p>
      <button
        onClick={() => onDismiss(toast.id)}
        aria-label="Close notification"
        className="flex-shrink-0 text-[--text-muted] hover:text-[--text-secondary] transition-colors text-base leading-none mt-0.5"
      >
        &times;
      </button>
    </div>
  )
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, dispatch] = useReducer(reducer, [])
  const mountedRef = useRef(false)

  // Register the module-level controller
  const addFn: AddToastFn = useCallback((message, variant) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    dispatch({ type: 'ADD', toast: { id, message, variant, dismissing: false } })
    setTimeout(() => dispatch({ type: 'DISMISS', id }), 4000)
  }, [])

  useEffect(() => {
    mountedRef.current = true
    _registerToastController(addFn)
    return () => {
      _unregisterToastController()
      mountedRef.current = false
    }
  }, [addFn])

  const handleDismiss = useCallback((id: string) => {
    dispatch({ type: 'DISMISS', id })
  }, [])

  // After dismiss animation (~300 ms), remove from state
  useEffect(() => {
    const dismissing = toasts.filter((t) => t.dismissing)
    if (dismissing.length === 0) return
    const timer = setTimeout(() => {
      dismissing.forEach((t) => dispatch({ type: 'REMOVE', id: t.id }))
    }, 350)
    return () => clearTimeout(timer)
  }, [toasts])

  const portal =
    typeof window !== 'undefined'
      ? createPortal(
          <div
            aria-label="Notifications"
            className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 items-end"
          >
            {toasts.map((t) => (
              <ToastItem key={t.id} toast={t} onDismiss={handleDismiss} />
            ))}
          </div>,
          document.body
        )
      : null

  return (
    <ToastContext.Provider value={{ dispatch }}>
      {children}
      {portal}
    </ToastContext.Provider>
  )
}
