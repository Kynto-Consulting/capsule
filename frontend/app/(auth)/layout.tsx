import Link from 'next/link'
import Image from 'next/image'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative min-h-full flex items-center justify-center p-4 bg-grid overflow-hidden"
      style={{
        '--border': 'rgba(124, 58, 237, 0.16)',
        '--border-strong': 'rgba(124, 58, 237, 0.28)',
        '--border-focus': 'rgba(167, 139, 250, 0.55)',
      } as React.CSSProperties}
    >
      {/* Ambient glow blobs */}
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        aria-hidden
      >
        <div
          className="absolute -top-40 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full opacity-20"
          style={{
            background: 'radial-gradient(circle, #7c3aed 0%, transparent 70%)',
            filter: 'blur(60px)',
          }}
        />
        <div
          className="absolute top-1/2 -left-40 w-[400px] h-[400px] rounded-full opacity-10"
          style={{
            background: 'radial-gradient(circle, #4f46e5 0%, transparent 70%)',
            filter: 'blur(60px)',
          }}
        />
        <div
          className="absolute bottom-0 right-0 w-[400px] h-[400px] rounded-full opacity-10"
          style={{
            background: 'radial-gradient(circle, #7c3aed 0%, transparent 70%)',
            filter: 'blur(80px)',
          }}
        />
      </div>
      <div className="relative z-10 w-full max-w-sm animate-fade-up">
        <div className="flex flex-col items-center mb-6">
          <Link href="/" className="block">
            <Image src="/logo.png" alt="Capsule" width={48} height={48} className="rounded-xl" priority />
          </Link>
        </div>
        {children}
        <div className="mt-6 text-center">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs transition-colors text-[--text-muted] hover:text-[--text-secondary]"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M7.5 2L3.5 6l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Back to home
          </Link>
        </div>
      </div>
    </div>
  )
}
