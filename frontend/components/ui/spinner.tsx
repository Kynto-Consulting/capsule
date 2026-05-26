import { cn } from '@/lib/utils'

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn('inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin', className)}
      aria-label="Loading"
    />
  )
}

export function PageSpinner() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <Spinner className="w-8 h-8 text-[--accent]" />
        <p className="text-sm text-[--text-muted]">Loading…</p>
      </div>
    </div>
  )
}
