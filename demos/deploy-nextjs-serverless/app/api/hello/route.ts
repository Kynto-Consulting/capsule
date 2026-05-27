import { NextResponse } from 'next/server'
export async function GET() {
  return NextResponse.json({
    message: 'Hello from Capsule Next.js Serverless!',
    runtime: 'lambda-container',
    functionName: process.env.AWS_LAMBDA_FUNCTION_NAME ?? 'local',
    timestamp: new Date().toISOString(),
  })
}
