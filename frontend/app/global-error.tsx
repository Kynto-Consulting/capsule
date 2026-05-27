'use client'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error
  reset: () => void
}) {
  return (
    <html>
      <body style={{ margin: 0, background: '#0d0d0f', fontFamily: 'system-ui, sans-serif' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            padding: '24px',
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '360px',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '12px',
              padding: '32px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '16px',
              textAlign: 'center',
            }}
          >
            {/* Warning triangle */}
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '10px',
                background: 'rgba(239,68,68,0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="rgb(239,68,68)"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#f4f4f5' }}>
                Something went wrong
              </h2>
              <p style={{ margin: 0, fontSize: '12px', color: 'rgba(244,244,245,0.45)', lineHeight: 1.6 }}>
                {error.message}
              </p>
            </div>

            <button
              onClick={reset}
              style={{
                marginTop: '8px',
                padding: '8px 16px',
                fontSize: '13px',
                fontWeight: 500,
                background: '#7c3aed',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
