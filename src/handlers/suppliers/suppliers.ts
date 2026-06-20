import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import { supabase } from '../../db/supabase'
import { authenticate } from '../../middleware/auth'
import { authorize } from '../../middleware/roles'
import { json, error, serverError } from '../../utils/response'
import { parsePagination } from '../../utils/pagination'

const supplierSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  address: z.string().optional(),
})

export async function listSuppliers(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'suppliers', res)) return

  const { limit, offset } = parsePagination(req)

  const { data, count, error: dbErr } = await supabase
    .from('suppliers')
    .select('*', { count: 'exact' })
    .order('name')
    .range(offset, offset + limit - 1)

  if (dbErr) return serverError(res, dbErr)
  res.setHeader('X-Total-Count', String(count ?? 0))
  return json(res, data)
}

export async function createSupplier(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'suppliers', res)) return

  const parsed = supplierSchema.safeParse(req.body)
  if (!parsed.success) return error(res, parsed.error.message, 400)

  const { data, error: dbErr } = await supabase
    .from('suppliers')
    .insert(parsed.data)
    .select()
    .single()

  if (dbErr) return serverError(res, dbErr)
  return json(res, data, 201)
}

export async function updateSupplier(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'suppliers', res)) return

  const { id } = (req as any).params
  const parsed = supplierSchema.partial().safeParse(req.body)
  if (!parsed.success) return error(res, parsed.error.message, 400)

  const { data, error: dbErr } = await supabase
    .from('suppliers')
    .update(parsed.data)
    .eq('id', id)
    .select()
    .single()

  if (dbErr) return serverError(res, dbErr)
  return json(res, data)
}

export async function deleteSupplier(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'suppliers', res)) return

  const { id } = (req as any).params
  const { error: dbErr } = await supabase
    .from('suppliers')
    .delete()
    .eq('id', id)

  if (dbErr) return serverError(res, dbErr)
  return json(res, { success: true })
}
