import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import { supabase } from '../../db/supabase'
import { authenticate } from '../../middleware/auth'
import { authorize } from '../../middleware/roles'
import { json, error, serverError } from '../../utils/response'

const schema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  sort_order: z.number().int().optional(),
  active: z.boolean().optional(),
})

export async function listCategories(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'catalog', res, 'read')) return

  const { data, error: dbErr } = await supabase
    .from('product_categories')
    .select('*, products(count)')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (dbErr) return serverError(res, dbErr)
  return json(res, data)
}

export async function createCategory(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'catalog', res)) return

  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return error(res, parsed.error.message, 400)

  const { data, error: dbErr } = await supabase
    .from('product_categories')
    .insert(parsed.data)
    .select()
    .single()

  if (dbErr) return serverError(res, dbErr)
  return json(res, data, 201)
}

export async function updateCategory(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'catalog', res)) return

  const { id } = (req as any).params
  const parsed = schema.partial().safeParse(req.body)
  if (!parsed.success) return error(res, parsed.error.message, 400)

  const { data, error: dbErr } = await supabase
    .from('product_categories')
    .update(parsed.data)
    .eq('id', id)
    .select()
    .single()

  if (dbErr) return serverError(res, dbErr)
  return json(res, data)
}

export async function deleteCategory(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'catalog', res)) return

  const { id } = (req as any).params
  const { error: dbErr } = await supabase
    .from('product_categories')
    .delete()
    .eq('id', id)

  if (dbErr) return serverError(res, dbErr)
  return json(res, { success: true })
}
