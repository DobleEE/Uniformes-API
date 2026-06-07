import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { json, error } from '../../utils/response'

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
})

export async function login(req: VercelRequest, res: VercelResponse) {
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    return error(res, 'Email y password requeridos', 400)
  }

  const client = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!
  )

  const admin = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const [authResult, userResult] = await Promise.all([
    client.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    }),
    admin.from('app_users').select('role').eq('email', parsed.data.email).single(),
  ])

  if (authResult.error || !authResult.data.session) {
    return error(res, 'Credenciales invalidas', 401)
  }

  return json(res, {
    token: authResult.data.session.access_token,
    refresh_token: authResult.data.session.refresh_token,
    user: {
      id: authResult.data.user.id,
      email: authResult.data.user.email,
      role: userResult.data?.role || 'ventas',
    },
  })
}
