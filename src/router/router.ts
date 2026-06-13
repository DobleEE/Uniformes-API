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
  // CORS — restringido al origen del frontend configurado en ALLOWED_ORIGIN
  const allowedOrigin = process.env.ALLOWED_ORIGIN || ''
  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin)
  } else {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*')
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
