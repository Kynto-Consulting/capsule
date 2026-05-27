'use client'

import { forwardRef } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SelectOption {
  value: string
  label: string
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  options: SelectOption[]
  placeholder?: string
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, error, options, placeholder, id, ...props }, ref) => {
    const selectId = id ?? label?.toLowerCase().replace(/\s+/g, '-')

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={selectId}
            className="text-xs font-medium text-[--text-secondary] uppercase tracking-wider"
          >
            {label}
          </label>
        )}
        <div className="relative flex items-center">
          <select
            id={selectId}
            ref={ref}
            className={cn(
              'w-full h-10 appearance-none',
              'bg-[--bg-surface] text-[--text-primary]',
              'border border-[--border] rounded-[--radius-sm]',
              'px-3 py-2 pr-9 text-sm',
              'transition-all duration-150',
              'focus:outline-none focus:border-[--border-focus] focus:bg-[--bg-raised]',
              'focus:shadow-[0_0_0_3px_var(--accent-dim)]',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              // Show muted color when placeholder option is selected
              !props.value && placeholder
                ? 'text-[--text-muted]'
                : 'text-[--text-primary]',
              error &&
                'border-[rgba(239,68,68,0.5)] focus:border-[var(--error)] focus:shadow-[0_0_0_3px_var(--error-dim)]',
              className,
            )}
            {...props}
          >
            {placeholder && (
              <option value="" disabled>
                {placeholder}
              </option>
            )}
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {/* Custom chevron — pointer-events-none so clicks pass through to select */}
          <span className="absolute right-3 text-[--text-muted] pointer-events-none flex items-center">
            <ChevronDown size={14} strokeWidth={2} />
          </span>
        </div>
        {error && <p className="text-xs text-[--error]">{error}</p>}
      </div>
    )
  }
)
Select.displayName = 'Select'

export { Select }
