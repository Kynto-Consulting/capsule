'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SelectOption {
  value: string
  label: string
}

export interface SelectProps {
  label?: string
  error?: string
  options: SelectOption[]
  placeholder?: string
  value: string
  onChange: (value: string) => void
  className?: string
  disabled?: boolean
}

function Select({
  className,
  label,
  error,
  options,
  placeholder,
  value,
  onChange,
  disabled,
}: SelectProps) {
  const [open, setOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState<number>(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const selectId = label?.toLowerCase().replace(/\s+/g, '-')

  const selectedOption = options.find((o) => o.value === value)

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [open])

  // Reset focused index when opening
  function handleOpen() {
    if (disabled) return
    const currentIdx = options.findIndex((o) => o.value === value)
    setFocusedIndex(currentIdx >= 0 ? currentIdx : 0)
    setOpen((v) => !v)
  }

  function handleSelect(optValue: string) {
    onChange(optValue)
    setOpen(false)
    triggerRef.current?.focus()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const currentIdx = options.findIndex((o) => o.value === value)
        setFocusedIndex(currentIdx >= 0 ? currentIdx : 0)
        setOpen(true)
      }
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusedIndex((i) => Math.min(i + 1, options.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusedIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (focusedIndex >= 0 && focusedIndex < options.length) {
        handleSelect(options[focusedIndex].value)
      }
    }
  }

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
      <div ref={containerRef} className={cn('relative', className)}>
        {/* Trigger */}
        <button
          id={selectId}
          ref={triggerRef}
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-disabled={disabled}
          disabled={disabled}
          onClick={handleOpen}
          onKeyDown={handleKeyDown}
          className={cn(
            'w-full h-10 flex items-center justify-between gap-2',
            'bg-[--bg-surface] text-[--text-primary]',
            'border border-[--border] rounded-[--radius-sm]',
            'px-3 py-2 text-sm',
            'transition-all duration-150',
            'focus:outline-none focus:border-[--border-focus] focus:bg-[--bg-raised]',
            'focus:shadow-[0_0_0_3px_var(--accent-dim)]',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            !value && placeholder ? 'text-[--text-muted]' : 'text-[--text-primary]',
            error && 'border-[rgba(239,68,68,0.5)] focus:border-[var(--error)] focus:shadow-[0_0_0_3px_var(--error-dim)]',
          )}
        >
          <span className="truncate">
            {selectedOption ? selectedOption.label : (placeholder ?? 'Select…')}
          </span>
          <ChevronDown
            size={14}
            strokeWidth={2}
            className={cn(
              'text-[--text-muted] flex-shrink-0 transition-transform duration-150',
              open && 'rotate-180',
            )}
          />
        </button>

        {/* Panel */}
        {open && (
          <div
            role="listbox"
            className={cn(
              'absolute z-50 mt-1 min-w-full max-h-60 overflow-y-auto',
              'bg-[--bg-overlay] border border-[--border] rounded-[--radius-sm]',
              'shadow-[0_8px_24px_rgba(0,0,0,0.4)] py-1',
            )}
          >
            {options.map((opt, idx) => {
              const isSelected = opt.value === value
              const isFocused = idx === focusedIndex
              return (
                <div
                  key={opt.value}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setFocusedIndex(idx)}
                  onMouseDown={(e) => {
                    // prevent blur on trigger before click registers
                    e.preventDefault()
                    handleSelect(opt.value)
                  }}
                  className={cn(
                    'flex items-center justify-between gap-2 px-3 py-2 text-sm cursor-pointer',
                    'transition-colors duration-75',
                    isFocused ? 'bg-[--bg-raised]' : '',
                    isSelected ? 'text-[--accent-light]' : 'text-[--text-primary]',
                  )}
                >
                  <span className="truncate">{opt.label}</span>
                  {isSelected && (
                    <Check size={13} strokeWidth={2.5} className="flex-shrink-0 text-[--accent-light]" />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      {error && <p className="text-xs text-[--error]">{error}</p>}
    </div>
  )
}

Select.displayName = 'Select'

export { Select }
