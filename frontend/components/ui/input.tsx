'use client'

import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
  icon?: React.ReactNode
  suffix?: React.ReactNode
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, hint, icon, suffix, id, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-')

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="text-xs font-medium text-[--text-secondary] uppercase tracking-wider"
          >
            {label}
          </label>
        )}
        <div className="relative flex items-center">
          {icon && (
            <span className="absolute left-3 text-[--text-muted] flex items-center pointer-events-none">
              {icon}
            </span>
          )}
          <input
            id={inputId}
            ref={ref}
            className={cn(
              'w-full h-10 rounded-[--radius] text-sm',
              'bg-[--bg-surface] text-[--text-primary]',
              'border border-[--border]',
              'placeholder:text-[--text-muted]',
              'transition-all duration-150',
              'focus:outline-none focus:border-[--border-focus] focus:bg-[--bg-raised]',
              'focus:shadow-[0_0_0_3px_var(--accent-dim)]',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              icon ? 'pl-9' : 'pl-3.5',
              suffix ? 'pr-10' : 'pr-3.5',
              error && 'border-[rgba(239,68,68,0.5)] focus:border-[var(--error)] focus:shadow-[0_0_0_3px_var(--error-dim)]',
              className,
            )}
            {...props}
          />
          {suffix && (
            <span className="absolute right-3 text-[--text-muted] flex items-center">
              {suffix}
            </span>
          )}
        </div>
        {error && <p className="text-xs text-[--error]">{error}</p>}
        {hint && !error && <p className="text-xs text-[--text-muted]">{hint}</p>}
      </div>
    )
  }
)
Input.displayName = 'Input'

export { Input }
