import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import { supabase } from '../../db/supabase'
import { authenticate } from '../../middleware/auth'
import { authorize } from '../../middleware/roles'
import { json, error } from '../../utils/response'

const itemBaseSchema = z.object({
  uniform_type: z.string().optional(),
  piece_type: z.string().optional(),
  fabric_id: z.string().uuid().nullable().optional(),
  model_id: z.string().uuid().nullable().optional(),
  item_notes: z.string().nullable().optional(),
  quantity: z.number().int().positive(),
  price_per_unit: z.number().nonnegative(),
})

function normalizeItem(d: z.infer<typeof itemBaseSchema>) {
  return { ...d, uniform_type: d.uniform_type || d.piece_type || '' }
}

async function recalcTotal(orderId: string) {
  const { data: items } = await supabase
    .from('order_items')
    .select('quantity, price_per_unit')
    .eq('order_id', orderId)

  const total = (items || []).reduce(
    (sum, i) => sum + i.quantity * i.price_per_unit,
    0
  )

  await supabase
    .from('orders')
    .update({ total_price: total })
    .eq('id', orderId)
}

export async function listOrderItems(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'order_items', res)) return

  const { orderId } = (req as any).params
  const { data, error: dbErr } = await supabase
    .from('order_items')
    .select('*, fabric:fabric_id(id, name, code, color), model:model_id(id, number, season, season_year)')
    .eq('order_id', orderId)

  if (dbErr) return error(res, dbErr.message, 500)
  return json(res, data)
}

export async function createOrderItem(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'order_items', res)) return

  const { orderId } = (req as any).params
  const parsed = itemBaseSchema.safeParse(req.body)
  if (!parsed.success) return error(res, parsed.error.message, 400)

  const { data, error: dbErr } = await supabase
    .from('order_items')
    .insert({ ...normalizeItem(parsed.data), order_id: orderId })
    .select()
    .single()

  if (dbErr) return error(res, dbErr.message, 500)

  await recalcTotal(orderId)
  return json(res, data, 201)
}

export async function updateOrderItem(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'order_items', res)) return

  const { id } = (req as any).params
  const parsed = itemBaseSchema.partial().safeParse(req.body)
  if (!parsed.success) return error(res, parsed.error.message, 400)

  const { data, error: dbErr } = await supabase
    .from('order_items')
    .update(parsed.data)
    .eq('id', id)
    .select()
    .single()

  if (dbErr) return error(res, dbErr.message, 500)

  await recalcTotal(data.order_id)
  return json(res, data)
}

export async function deleteOrderItem(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'order_items', res)) return

  const { id } = (req as any).params

  // Obtener order_id antes de borrar
  const { data: item } = await supabase
    .from('order_items')
    .select('order_id')
    .eq('id', id)
    .single()

  const { error: dbErr } = await supabase
    .from('order_items')
    .delete()
    .eq('id', id)

  if (dbErr) return error(res, dbErr.message, 500)

  if (item) await recalcTotal(item.order_id)
  return json(res, { success: true })
}
