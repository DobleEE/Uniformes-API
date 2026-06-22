import type { VercelRequest, VercelResponse } from '@vercel/node'
import { error } from '../utils/response'

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type Handler = (req: VercelRequest, res: VercelResponse) => Promise<any>

interface Route {
  method: HttpMethod
  pattern: RegExp
  handler: Handler
  paramNames: string[]
}

const routes: Route[] = []

function pathToRegex(path: string): { regex: RegExp; paramNames: string[] } {
  const paramNames: string[] = []
  const regexStr = path.replace(/:(\w+)/g, (_, name) => {
    paramNames.push(name)
    return '([^/]+)'
  })
  return { regex: new RegExp(`^${regexStr}$`), paramNames }
}

export function addRoute(method: HttpMethod, path: string, handler: Handler) {
  const { regex, paramNames } = pathToRegex(path)
  routes.push({ method, pattern: regex, handler, paramNames })
}

export function get(path: string, handler: Handler) {
  addRoute('GET', path, handler)
}
export function post(path: string, handler: Handler) {
  addRoute('POST', path, handler)
}
export function put(path: string, handler: Handler) {
  addRoute('PUT', path, handler)
}
export function patch(path: string, handler: Handler) {
  addRoute('PATCH', path, handler)
}
export function del(path: string, handler: Handler) {
  addRoute('DELETE', path, handler)
}

export async function handleRequest(req: VercelRequest, res: VercelResponse) {
  // CORS — fail-closed. Solo se reflejan orígenes de la allowlist
  // (ALLOWED_ORIGIN, separada por comas). NUNCA se refleja un origen
  // arbitrario junto con Allow-Credentials. En local (sin VERCEL) se
  // permite localhost/127.0.0.1 para desarrollo.
  const allowedOrigins = (process.env.ALLOWED_ORIGIN || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
  const requestOrigin = req.headers.origin || ''
  const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(requestOrigin)

  let originToAllow = ''
  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    originToAllow = requestOrigin
  } else if (isLocalhost) {
    originToAllow = requestOrigin
  } else if (allowedOrigins.length > 0) {
    // Origen no permitido: se devuelve el origen canónico configurado, que
    // no coincidirá con el del atacante, por lo que el navegador bloqueará
    // la respuesta con credenciales.
    originToAllow = allowedOrigins[0]
  }
  if (originToAllow) {
    res.setHeader('Access-Control-Allow-Origin', originToAllow)
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Refresh-Token')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Expose-Headers', 'X-New-Access-Token, X-New-Refresh-Token')
  res.setHeader('Vary', 'Origin')

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  const url = req.url?.replace(/\?.*$/, '') || '/'
  const method = req.method as HttpMethod

  for (const route of routes) {
    if (route.method !== method) continue
    const match = url.match(route.pattern)
    if (!match) continue

    // Inyectar params en el query
    const params: Record<string, string> = {}
    route.paramNames.forEach((name, i) => {
      params[name] = match[i + 1]
    })
      ; (req as any).params = params

    try {
      await route.handler(req, res)
    } catch (err) {
      console.error('Handler error:', err)
      error(res, 'Error interno del servidor', 500)
    }
    return
  }

  error(res, `Ruta no encontrada: ${method} ${url}`, 404)
}
