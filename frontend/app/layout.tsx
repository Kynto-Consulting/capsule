import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Providers } from '@/components/providers'
import './globals.css'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: { default: 'Capsule', template: '%s · Capsule' },
  description: 'Your infrastructure, encapsulated.',
  icons: {
    icon: [
      { url: '/icon.png', type: 'image/png', sizes: '1024x1024' },
      { url: '/favicon.ico', sizes: '32x32' },
    ],
    apple: [{ url: '/apple-icon.png', sizes: '1024x1024', type: 'image/png' }],
    shortcut: '/icon.png',
  },
  openGraph: {
    title: 'Capsule',
    description: 'Your infrastructure, encapsulated.',
    images: [{ url: '/logo.png', width: 1024, height: 1024 }],
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full`}>
      <body className="h-full antialiased"><Providers>{children}</Providers></body>
    </html>
  )
}
