import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import { supabase, supabaseAnon } from '../../db/supabase'
import { json, error } from '../../utils/response'
import { cookieAttrs } from '../../utils/cookies'

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
})

const RATE_LIMIT_MAX = 5        // intentos fallidos por email
const RATE_LIMIT_IP_MAX = 20    // intentos fallidos por IP (frena el spray de emails)
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000 // 15 minutos

function getClientIp(req: VercelRequest): string {
  const fwd = req.headers['x-forwarded-for']
  const raw = Array.isArray(fwd) ? fwd[0] : fwd
  return (raw?.split(',')[0].trim()) || req.socket?.remoteAddress || 'unknown'
}

export async function login(req: VercelRequest, res: VercelResponse) {
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    return error(res, 'Email y password requeridos', 400)
  }

  const email = parsed.data.email
  const ip = getClientIp(req)
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString()

  const [{ count: failedByEmail }, { count: failedByIp }] = await Promise.all([
    supabase
      .from('activity_log')
      .select('id', { count: 'exact', head: true })
      .eq('action', 'login_failed')
      .eq('entity', 'auth')
      .eq('details', email)
      .gte('created_at', windowStart),
    supabase
      .from('activity_log')
      .select('id', { count: 'exact', head: true })
      .eq('action', 'login_failed')
      .eq('entity', 'auth')
      .eq('ip', ip)
      .gte('created_at', windowStart),
  ])

  if ((failedByEmail || 0) >= RATE_LIMIT_MAX || (failedByIp || 0) >= RATE_LIMIT_IP_MAX) {
    return error(res, 'Demasiados intentos fallidos. Intenta de nuevo en 15 minutos.', 429)
  }

  const [authResult, userResult] = await Promise.all([
    supabaseAnon.auth.signInWithPassword({ email, password: parsed.data.password }),
    supabase.from('app_users').select('role').eq('email', email).single(),
  ])

  if (authResult.error || !authResult.data.session) {
    await supabase.from('activity_log').insert({
      action: 'login_failed',
      entity: 'auth',
      details: email,
      ip,
    })
    return error(res, 'Credenciales invalidas', 401)
  }

  if (!userResult.data?.role) {
    return error(res, 'Usuario no autorizado en el sistema', 403)
  }

  const session = authResult.data.session
  res.setHeader('Set-Cookie', [
    `access_token=${session.access_token}; ${cookieAttrs(3600)}`,
    `refresh_token=${session.refresh_token}; ${cookieAttrs(604800)}`,
  ])

  return json(res, {
    user: {
      id: authResult.data.user.id,
      email: authResult.data.user.email,
      role: userResult.data.role,
    },
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  })
}
