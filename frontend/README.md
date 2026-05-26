Capsule dashboard built with Next.js.

## Getting Started

Create your local env file first:

```bash
cp .env.example .env.local
```

Required local variables:

```env
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_WS_URL=ws://localhost:8080
```

Then run the development server:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

For production builds, `NEXT_PUBLIC_API_URL` must point at the public API host, for example `https://api.tumi-ai.com`.

## Deploy

The frontend image is built with the public API URL baked in. Make sure your build pipeline passes `NEXT_PUBLIC_API_URL=https://api.tumi-ai.com` and, if you use websockets, `NEXT_PUBLIC_WS_URL=wss://api.tumi-ai.com`.
