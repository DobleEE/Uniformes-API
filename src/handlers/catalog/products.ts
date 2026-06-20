import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import { supabase } from '../../db/supabase'
import { authenticate } from '../../middleware/auth'
import { authorize } from '../../middleware/roles'
import { json, error, serverError } from '../../utils/response'

const schema = z.object({
  category_id: z.string().uuid(),
  name: z.string().min(1),
  model_ref: z.string().optional(),
  description: z.string().optional(),
  sort_order: z.number().int().optional(),
  active: z.boolean().optional(),
})

export async function listProducts(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'catalog', res, 'read')) return

  let query = supabase
    .from('products')
    .select('*, product_categories(name)')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  const categoryId = req.query.category_id as string
  if (categoryId) query = query.eq('category_id', categoryId)

  const activeOnly = req.query.active !== 'false'
  if (activeOnly) query = query.eq('active', true)

  const { data, error: dbErr } = await query
  if (dbErr) return serverError(res, dbErr)
  return json(res, data)
}

export async function createProduct(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'catalog', res)) return

  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return error(res, parsed.error.message, 400)

  const { data, error: dbErr } = await supabase
    .from('products')
    .insert(parsed.data)
    .select('*, product_categories(name)')
    .single()

  if (dbErr) return serverError(res, dbErr)
  return json(res, data, 201)
}

export async function updateProduct(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'catalog', res)) return

  const { id } = (req as any).params
  const parsed = schema.partial().safeParse(req.body)
  if (!parsed.success) return error(res, parsed.error.message, 400)

  const { data, error: dbErr } = await supabase
    .from('products')
    .update(parsed.data)
    .eq('id', id)
    .select('*, product_categories(name)')
    .single()

  if (dbErr) return serverError(res, dbErr)
  return json(res, data)
}

export async function deleteProduct(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'catalog', res)) return

  const { id } = (req as any).params
  const { error: dbErr } = await supabase
    .from('products')
    .delete()
    .eq('id', id)

  if (dbErr) return serverError(res, dbErr)
  return json(res, { success: true })
}
