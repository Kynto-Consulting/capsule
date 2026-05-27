'use client'

export default function DashboardError({
  error,
  reset,
}: {
  error: Error
  reset: () => void
}) {
  return (
    <div className="flex items-center justify-center min-h-[60vh] p-6">
      <div className="w-full max-w-sm bg-[--bg-raised] border border-[--border] rounded-[--radius-lg] p-8 flex flex-col items-center gap-4 text-center shadow-[--shadow]">
        {/* Warning triangle icon */}
        <div className="w-12 h-12 rounded-[--radius-lg] bg-[rgba(239,68,68,0.1)] flex items-center justify-center flex-shrink-0">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="rgb(239,68,68)"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>

        <div className="flex flex-col gap-1.5">
          <h2 className="text-base font-semibold text-[--text-primary]">Something went wrong</h2>
          <p className="text-xs text-[--text-muted] leading-relaxed">{error.message}</p>
        </div>

        <button
          onClick={reset}
          className="mt-2 px-4 py-2 text-sm font-medium bg-[--accent] hover:bg-[--accent-dim] text-white rounded-[--radius-sm] transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
