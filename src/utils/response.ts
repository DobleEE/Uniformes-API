import type { VercelResponse } from '@vercel/node'

export function json(res: VercelResponse, data: unknown, status = 200) {
  return res.status(status).json(data)
}

export function error(res: VercelResponse, message: string, status = 400) {
  return res.status(status).json({ error: message })
}

// Errores de base de datos / internos: se registra el detalle en el servidor
// pero NUNCA se filtra al cliente (evita exponer esquema, constraints, etc.).
export function serverError(res: VercelResponse, err: unknown, context = 'db') {
  console.error(`[serverError:${context}]`, err)
  return res.status(500).json({ error: 'Error interno del servidor' })
}
