/**
 * Capsule Lambda Node.js Demo
 * Deploy type: lambda
 * Runtime: nodejs20.x
 */
exports.handler = async (event) => {
  const method = event.requestContext?.http?.method ?? event.httpMethod ?? 'UNKNOWN';
  const path   = event.requestContext?.http?.path   ?? event.path        ?? '/';

  console.log(`${method} ${path}`);

  if (path === '/health') {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'ok', runtime: 'lambda-node', ts: Date.now() }),
    };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Hello from Capsule Lambda (Node.js)!',
      method,
      path,
      env: process.env.APP_ENV ?? 'production',
      ts: new Date().toISOString(),
    }),
  };
};
