import { cn } from '@/lib/utils'

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  hover?: boolean
  glow?: boolean
}

export function Card({ className, hover, glow, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-[--radius-lg] border border-[--border] bg-[--bg-surface]',
        hover && [
          'cursor-pointer transition-all duration-200',
          'hover:border-[--border-strong] hover:bg-[--bg-raised]',
          'hover:shadow-[0_0_24px_rgba(124,58,237,0.1)]',
          'hover:-translate-y-0.5',
        ],
        glow && 'shadow-[0_0_32px_rgba(124,58,237,0.12)]',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function CardHeader({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex items-center justify-between px-5 py-4 border-b border-[--border]', className)} {...props}>
      {children}
    </div>
  )
}

export function CardBody({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('px-5 py-4', className)} {...props}>
      {children}
    </div>
  )
}

export function CardFooter({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex items-center px-5 py-3 border-t border-[--border]', className)} {...props}>
      {children}
    </div>
  )
}
