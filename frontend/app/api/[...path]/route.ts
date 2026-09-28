import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
])

const RETRYABLE = new Set(['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT'])

type RouteContext = { params: Promise<{ path: string[] }> }

function apiOrigin(): URL {
  return new URL(process.env.AILMS_API_ORIGIN || 'http://127.0.0.1:8000')
}

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error && 'code' in error && typeof error.code === 'string') {
    return error.code
  }
  return ''
}

function forwardOnce(request: NextRequest, targetPath: string, body: Buffer): Promise<NextResponse> {
  const origin = apiOrigin()
  const transport = origin.protocol === 'https:' ? httpsRequest : httpRequest
  const headers: Record<string, string | string[]> = {}

  request.headers.forEach((value, key) => {
    const lower = key.toLowerCase()
    if (HOP_BY_HOP.has(lower) || lower === 'host' || lower === 'content-length') return
    const existing = headers[lower]
    if (existing === undefined) headers[lower] = value
    else if (Array.isArray(existing)) existing.push(value)
    else headers[lower] = [existing, value]
  })

  headers.host = origin.host
  headers.connection = 'close'
  if (body.length > 0 || !['GET', 'HEAD'].includes(request.method.toUpperCase())) {
    headers['content-length'] = String(body.length)
  }

  return new Promise((resolve, reject) => {
    const upstream = transport(
      {
        protocol: origin.protocol,
        hostname: origin.hostname,
        port: origin.port || (origin.protocol === 'https:' ? 443 : 80),
        method: request.method,
        path: targetPath,
        headers,
        agent: false,
        timeout: 120_000,
      },
      (response: IncomingMessage) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => {
          const responseHeaders = new Headers()
          for (const [key, value] of Object.entries(response.headers)) {
            if (value == null || HOP_BY_HOP.has(key.toLowerCase())) continue
            if (Array.isArray(value)) {
              for (const item of value) responseHeaders.append(key, item)
            } else {
              responseHeaders.set(key, value)
            }
          }
          resolve(
            new NextResponse(new Uint8Array(Buffer.concat(chunks)), {
              status: response.statusCode ?? 502,
              headers: responseHeaders,
            }),
          )
        })
        response.on('error', reject)
      },
    )

    upstream.on('timeout', () => {
      upstream.destroy(Object.assign(new Error('API timed out'), { code: 'ETIMEDOUT' }))
    })
    upstream.on('error', reject)
    if (body.length > 0) upstream.write(body)
    upstream.end()
  })
}

async function handle(request: NextRequest, context: RouteContext) {
  const { path } = await context.params
  const targetPath = `/api/${path.map(encodeURIComponent).join('/')}${request.nextUrl.search}`
  const method = request.method.toUpperCase()
  const body = method === 'GET' || method === 'HEAD' ? Buffer.alloc(0) : Buffer.from(await request.arrayBuffer())

  try {
    try {
      return await forwardOnce(request, targetPath, body)
    } catch (error) {
      if (!RETRYABLE.has(errorCode(error))) throw error
      return await forwardOnce(request, targetPath, body)
    }
  } catch (error) {
    const code = errorCode(error)
    const origin = apiOrigin().origin
    const detail =
      code === 'ECONNREFUSED'
        ? `Cannot reach the API at ${origin}. Start the backend, then try again.`
        : code === 'ETIMEDOUT'
          ? `The API at ${origin} did not respond in time.`
          : `The API connection to ${origin} was reset. Try again.`
    return NextResponse.json({ detail }, { status: 502 })
  }
}

export const GET = handle
export const POST = handle
export const PUT = handle
export const PATCH = handle
export const DELETE = handle
