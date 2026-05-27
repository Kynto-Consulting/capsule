// Lambda handler for Next.js standalone output
// Bridges HTTP API Gateway V2 events to Next.js server
const { createServer, IncomingMessage, ServerResponse } = require('http')
const { parse } = require('url')

// Import the Next.js standalone server (built output)
let nextServer
function getNextServer() {
  if (!nextServer) {
    const NextServer = require('./.next/standalone/node_modules/next/dist/server/next-server').default
    nextServer = new NextServer({
      dir: __dirname,
      hostname: 'localhost',
      port: 3000,
      dev: false,
      customServer: true,
    })
  }
  return nextServer
}

exports.handler = async (event) => {
  const server = getNextServer()
  const requestHandler = server.getRequestHandler()

  return new Promise((resolve, reject) => {
    // Build Node.js request/response from Lambda event
    const path = event.rawPath || '/'
    const qs = event.rawQueryString ? `?${event.rawQueryString}` : ''
    const url = `${path}${qs}`

    const req = Object.assign(new IncomingMessage(null), {
      method: event.requestContext?.http?.method || 'GET',
      url,
      headers: event.headers || {},
    })

    // Attach body if present
    if (event.body) {
      const bodyBuffer = event.isBase64Encoded
        ? Buffer.from(event.body, 'base64')
        : Buffer.from(event.body)
      req.push(bodyBuffer)
      req.push(null)
    } else {
      req.push(null)
    }

    const chunks = []
    const res = Object.assign(new ServerResponse(req), {
      write(chunk) { chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)) },
      end(chunk) {
        if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        const body = Buffer.concat(chunks).toString('base64')
        resolve({
          statusCode: this.statusCode || 200,
          headers: Object.fromEntries(
            Object.entries(this.getHeaders()).map(([k, v]) => [k, String(v)])
          ),
          body,
          isBase64Encoded: true,
        })
      },
    })

    requestHandler(req, res).catch(reject)
  })
}
