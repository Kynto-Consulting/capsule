export const metadata = { title: 'Capsule Next.js Serverless Demo' }
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
        {children}
      </body>
    </html>
  )
}
