import { NextResponse } from 'next/server'
export async function GET() {
  return NextResponse.json({
    node: process.version,
    env: process.env.NODE_ENV,
    region: process.env.AWS_REGION ?? 'unknown',
    functionName: process.env.AWS_LAMBDA_FUNCTION_NAME ?? 'local',
    functionMemory: process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE ?? 'unknown',
    functionVersion: process.env.AWS_LAMBDA_FUNCTION_VERSION ?? 'unknown',
    deployType: 'lambda-container',
  })
}
