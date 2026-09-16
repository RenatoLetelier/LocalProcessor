import { net, protocol } from 'electron'
import { join, normalize, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

// The packaged renderer is served from a custom scheme instead of file:// so it
// gets a real origin (needed for the API's CORS allowlist) and a strict CSP.
export const RENDERER_SCHEME = 'app'
export const RENDERER_HOST = 'renderer'
export const RENDERER_ORIGIN = `${RENDERER_SCHEME}://${RENDERER_HOST}`

// Must run before app.whenReady()
export function registerRendererScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: RENDERER_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
    }
  ])
}

export function buildRendererCsp(apiBaseUrl: string): string {
  const wsUrl = apiBaseUrl.replace(/^http/, 'ws')
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${apiBaseUrl} ${wsUrl}`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'"
  ].join('; ')
}

export function serveRenderer(rendererDir: string, csp: string): void {
  const root = normalize(rendererDir)

  protocol.handle(RENDERER_SCHEME, async (request) => {
    const url = new URL(request.url)
    if (url.host !== RENDERER_HOST) return new Response('Not found', { status: 404 })

    const relative = decodeURIComponent(url.pathname)
    const filePath = normalize(join(root, relative === '/' ? 'index.html' : relative))
    if (!filePath.startsWith(root + sep)) return new Response('Forbidden', { status: 403 })

    const response = await net.fetch(pathToFileURL(filePath).toString())
    if (!filePath.endsWith('.html')) return response

    const headers = new Headers(response.headers)
    headers.set('Content-Security-Policy', csp)
    return new Response(response.body, { status: response.status, headers })
  })
}
