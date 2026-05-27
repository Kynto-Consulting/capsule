export default function Home() {
  return (
    <main>
      <h1>⚡ Capsule Next.js Serverless Demo</h1>
      <p>Running as a Lambda container image via Capsule.</p>
      <p>Deploy type: <strong>lambda</strong> — Next.js 14 standalone + AWS Lambda Web Adapter</p>
      <hr />
      <h2>API Routes</h2>
      <ul>
        <li><a href="/api/hello">/api/hello</a> — JSON response</li>
        <li><a href="/api/env">/api/env</a> — Runtime environment info</li>
      </ul>
      <hr />
      <h2>How it works</h2>
      <ul>
        <li>✅ Next.js builds to standalone output</li>
        <li>✅ AWS Lambda Web Adapter bridges Lambda events → HTTP</li>
        <li>✅ Deployed as ECR container image Lambda</li>
        <li>✅ Requests routed via Capsule proxy (SDK invoke)</li>
        <li>✅ No cold-start warm-up needed — scales to zero</li>
      </ul>
    </main>
  )
}
