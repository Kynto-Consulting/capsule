import Link from 'next/link'

interface BreadcrumbItem {
  label: string
  href?: string
}

export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs">
      {items.map((item, index) => {
        const isLast = index === items.length - 1
        return (
          <span key={index} className="flex items-center gap-1.5">
            {index > 0 && (
              <span className="text-[--text-muted] select-none">/</span>
            )}
            {isLast || !item.href ? (
              <span className="text-[--text-primary]">{item.label}</span>
            ) : (
              <Link
                href={item.href}
                className="text-[--text-muted] hover:text-[--text-secondary] transition-colors"
              >
                {item.label}
              </Link>
            )}
          </span>
        )
      })}
    </nav>
  )
}
