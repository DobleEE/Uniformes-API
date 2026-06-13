import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabase, supabaseAnon } from '../db/supabase'
import { error } from '../utils/response'
import { parseCookies, cookieAttrs } from '../utils/cookies'

export type UserRole = 'admin' | 'ventas' | 'almacen' | 'confeccion'

export interface AuthUser {
  id: string
  email: string
  role: UserRole
}

export interface AuthenticatedRequest extends VercelRequest {
  user: AuthUser
}

export async function authenticate(
  req: VercelRequest,
  res: VercelResponse
): Promise<AuthUser | null> {
  const cookies = parseCookies(req.headers.cookie || '')
  const cookieToken = cookies['access_token']
  const refreshToken = cookies['refresh_token']
    || (req.headers['x-refresh-token'] as string | undefined)
  const header = req.headers.authorization
  const headerToken = header?.startsWith('Bearer ') ? header.slice(7) : null
  const token = cookieToken || headerToken

  if (!token && !refreshToken) {
    error(res, 'Token requerido', 401)
    return null
  }

  let supabaseUserId: string | null = null
  let supabaseUserEmail: string | null = null

  // Intento 1: validar el access_token actual
  if (token) {
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (!authError && user) {
      supabaseUserId = user.id
      supabaseUserEmail = user.email ?? null
    }
  }

  // Intento 2: si el access_token falló, refrescar con el refresh_token
  if (!supabaseUserId && refreshToken) {
    const { data: refreshData, error: refreshError } = await supabaseAnon.auth.refreshSession({
      refresh_token: refreshToken,
    })

    if (!refreshError && refreshData.session && refreshData.user) {
      supabaseUserId = refreshData.user.id
      supabaseUserEmail = refreshData.user.email ?? null

      // Emitir nuevas cookies con los tokens renovados
      res.setHeader('Set-Cookie', [
        `access_token=${refreshData.session.access_token}; ${cookieAttrs(3600)}`,
        `refresh_token=${refreshData.session.refresh_token}; ${cookieAttrs(604800)}`,
      ])
      // Headers de respaldo para cuando el browser bloquea cookies de terceros
      res.setHeader('X-New-Access-Token', refreshData.session.access_token)
      res.setHeader('X-New-Refresh-Token', refreshData.session.refresh_token)
    }
  }

  if (!supabaseUserId) {
    error(res, 'Token invalido o expirado', 401)
    return null
  }

  // Obtener rol desde app_users (service_role bypassa RLS)
  const { data: appUser } = await supabase
    .from('app_users')
    .select('role')
    .eq('id', supabaseUserId)
    .single()

  if (!appUser) {
    error(res, 'Usuario no registrado en el sistema', 403)
    return null
  }

  return {
    id: supabaseUserId,
    email: supabaseUserEmail!,
    role: appUser.role as UserRole,
  }
}
