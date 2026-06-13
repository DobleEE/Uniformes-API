import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { supabase } from '../../db/supabase'
import { json, error } from '../../utils/response'

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
})

const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000 // 15 minutos

export async function login(req: VercelRequest, res: VercelResponse) {
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    return error(res, 'Email y password requeridos', 400)
  }

  const email = parsed.data.email
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString()

  const { count: failedCount } = await supabase
    .from('activity_log')
    .select('id', { count: 'exact', head: true })
    .eq('action', 'login_failed')
    .eq('entity', 'auth')
    .eq('details', email)
    .gte('created_at', windowStart)

  if ((failedCount || 0) >= RATE_LIMIT_MAX) {
    return error(res, 'Demasiados intentos fallidos. Intenta de nuevo en 15 minutos.', 429)
  }

  const client = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!
  )

  const [authResult, userResult] = await Promise.all([
    client.auth.signInWithPassword({ email, password: parsed.data.password }),
    supabase.from('app_users').select('role').eq('email', email).single(),
  ])

  if (authResult.error || !authResult.data.session) {
    await supabase.from('activity_log').insert({
      action: 'login_failed',
      entity: 'auth',
      details: email,
    })
    return error(res, 'Credenciales invalidas', 401)
  }

  if (!userResult.data?.role) {
    return error(res, 'Usuario no autorizado en el sistema', 403)
  }

  return json(res, {
    token: authResult.data.session.access_token,
    refresh_token: authResult.data.session.refresh_token,
    user: {
      id: authResult.data.user.id,
      email: authResult.data.user.email,
      role: userResult.data.role,
    },
  })
}
