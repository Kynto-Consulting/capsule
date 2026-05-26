'use client'

import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline'
type Size = 'sm' | 'md' | 'lg' | 'icon'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
}

const variants: Record<Variant, string> = {
  primary: [
    'bg-[--accent] text-white font-medium',
    'hover:bg-[--accent-hover]',
    'shadow-[0_0_20px_rgba(124,58,237,0.3)]',
    'hover:shadow-[0_0_28px_rgba(124,58,237,0.45)]',
    'active:scale-[0.98]',
  ].join(' '),
  secondary: [
    'bg-[--bg-raised] text-[--text-primary] font-medium',
    'border border-[--border]',
    'hover:bg-[--bg-overlay] hover:border-[--border-strong]',
  ].join(' '),
  outline: [
    'bg-transparent text-[--text-primary] font-medium',
    'border border-[--border-strong]',
    'hover:bg-[--accent-dim] hover:border-[--accent-light] hover:text-[--accent-light]',
  ].join(' '),
  ghost: [
    'bg-transparent text-[--text-secondary]',
    'hover:bg-[--bg-raised] hover:text-[--text-primary]',
  ].join(' '),
  danger: [
    'bg-[--error-dim] text-[--error] font-medium',
    'border border-[rgba(239,68,68,0.25)]',
    'hover:bg-[rgba(239,68,68,0.2)] hover:border-[rgba(239,68,68,0.4)]',
  ].join(' '),
}

const sizes: Record<Size, string> = {
  sm:   'h-8 px-3 text-xs rounded-[--radius-sm] gap-1.5',
  md:   'h-9 px-4 text-sm rounded-[--radius] gap-2',
  lg:   'h-11 px-6 text-sm rounded-[--radius] gap-2',
  icon: 'h-9 w-9 rounded-[--radius]',
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          'inline-flex items-center justify-center transition-all duration-150 cursor-pointer',
          'disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none',
          'select-none whitespace-nowrap',
          variants[variant],
          sizes[size],
          className,
        )}
        {...props}
      >
        {loading ? (
          <>
            <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin opacity-70" />
            <span className="opacity-70">{children}</span>
          </>
        ) : children}
      </button>
    )
  }
)
Button.displayName = 'Button'

export { Button }
export type { ButtonProps }
