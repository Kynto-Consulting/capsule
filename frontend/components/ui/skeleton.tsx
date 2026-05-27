import { cn } from '@/lib/utils'

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-[--radius-sm] animate-shimmer h-4', className)}
      {...props}
    />
  )
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-[--radius-lg] border border-[--border] bg-[--bg-surface] p-4 flex flex-col gap-3', className)}>
      <div className="flex items-start gap-2.5">
        <div className="w-8 h-8 rounded-[--radius-sm] animate-shimmer flex-shrink-0" />
        <div className="flex-1 space-y-2 pt-0.5">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
      <div className="flex justify-between pt-2 border-t border-[--border]">
        <Skeleton className="h-3 w-12" />
        <Skeleton className="h-3 w-16" />
      </div>
    </div>
  )
}
