export default function Home() {
  return (
    <main>
      <h1>🚀 Capsule Next.js Demo</h1>
      <p>Running serverless on AWS Lambda via Capsule.</p>
      <p>Deploy type: <strong>lambda</strong></p>
      <p>Built with Next.js 14 (App Router, standalone mode)</p>
      <hr />
      <h2>API Routes</h2>
      <ul>
        <li><a href="/api/hello">/api/hello</a> — JSON response</li>
        <li><a href="/api/env">/api/env</a> — Runtime environment info</li>
      </ul>
    </main>
  )
}
