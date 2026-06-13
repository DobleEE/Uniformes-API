import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import { supabase } from '../../db/supabase'
import { authenticate } from '../../middleware/auth'
import { authorize } from '../../middleware/roles'
import { json, error } from '../../utils/response'
import { parsePagination } from '../../utils/pagination'

const clientSchema = z.object({
  company_name: z.string().min(1),
  address: z.string().optional(),
  industry: z.string().optional(),
})

export async function listClients(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'clients', res)) return

  const { limit, offset } = parsePagination(req)

  const { data, count, error: dbErr } = await supabase
    .from('clients')
    .select('*, client_contacts(*)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (dbErr) return error(res, dbErr.message, 500)
  res.setHeader('X-Total-Count', String(count ?? 0))
  return json(res, data)
}

export async function getClient(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'clients', res)) return

  const { id } = (req as any).params
  const { data, error: dbErr } = await supabase
    .from('clients')
    .select('*, client_contacts(*)')
    .eq('id', id)
    .single()

  if (dbErr) return error(res, 'Cliente no encontrado', 404)
  return json(res, data)
}

export async function createClient(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'clients', res)) return

  const parsed = clientSchema.safeParse(req.body)
  if (!parsed.success) return error(res, parsed.error.message, 400)

  const { data, error: dbErr } = await supabase
    .from('clients')
    .insert(parsed.data)
    .select()
    .single()

  if (dbErr) return error(res, dbErr.message, 500)
  return json(res, data, 201)
}

export async function updateClient(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'clients', res)) return

  const { id } = (req as any).params
  const parsed = clientSchema.partial().safeParse(req.body)
  if (!parsed.success) return error(res, parsed.error.message, 400)

  const { data, error: dbErr } = await supabase
    .from('clients')
    .update(parsed.data)
    .eq('id', id)
    .select()
    .single()

  if (dbErr) return error(res, dbErr.message, 500)
  return json(res, data)
}

export async function deleteClient(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'clients', res)) return

  const { id } = (req as any).params
  const { error: dbErr } = await supabase.from('clients').delete().eq('id', id)

  if (dbErr) return error(res, dbErr.message, 500)
  return json(res, { success: true })
}
