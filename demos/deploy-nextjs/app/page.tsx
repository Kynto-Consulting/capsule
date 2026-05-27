export default function Home() {
  return (
    <main>
      <h1>🚀 Capsule Next.js Demo</h1>
      <p>Running as a Docker container via Capsule.</p>
      <p>Deploy type: <strong>docker</strong> — Next.js 14 standalone mode</p>
      <hr />
      <h2>API Routes</h2>
      <ul>
        <li><a href="/api/hello">/api/hello</a> — JSON response</li>
        <li><a href="/api/env">/api/env</a> — Runtime environment info</li>
      </ul>
      <hr />
      <h2>Features</h2>
      <ul>
        <li>✅ App Router (React Server Components)</li>
        <li>✅ Streaming SSR</li>
        <li>✅ API routes</li>
        <li>✅ Static assets via CDN</li>
      </ul>
    </main>
  )
}
