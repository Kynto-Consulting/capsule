import { cn } from '@/lib/utils'

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info' | 'violet'

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
  dot?: boolean
}

const variants: Record<BadgeVariant, string> = {
  default: 'bg-[--bg-overlay] text-[--text-secondary] border-[--border]',
  success: 'bg-[--success-dim] text-[--success] border-[rgba(16,185,129,0.2)]',
  warning: 'bg-[--warning-dim] text-[--warning] border-[rgba(245,158,11,0.2)]',
  error:   'bg-[--error-dim]   text-[--error]   border-[rgba(239,68,68,0.2)]',
  info:    'bg-[--info-dim]    text-[--info]    border-[rgba(59,130,246,0.2)]',
  violet:  'bg-[--accent-dim]  text-[--accent-light] border-[--border-strong]',
}

const dotColors: Record<BadgeVariant, string> = {
  default: 'bg-[--text-muted]',
  success: 'bg-[--success]',
  warning: 'bg-[--warning]',
  error:   'bg-[--error]',
  info:    'bg-[--info]',
  violet:  'bg-[--accent-light]',
}

export function Badge({ variant = 'default', dot, className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5',
        'text-xs font-medium rounded-full border',
        variants[variant],
        className,
      )}
      {...props}
    >
      {dot && (
        <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', dotColors[variant])} />
      )}
      {children}
    </span>
  )
}

export function statusToBadge(status: string): BadgeVariant {
  const map: Record<string, BadgeVariant> = {
    active: 'success', running: 'success', completed: 'success',
    building: 'info',  deploying: 'info',  provisioning: 'info',
    pending: 'warning', paused: 'warning', stopped: 'warning',
    failed: 'error', error: 'error', rolled_back: 'error',
    created: 'default', archived: 'default',
  }
  return map[status] ?? 'default'
}
