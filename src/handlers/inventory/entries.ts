import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import { supabase } from '../../db/supabase'
import { authenticate } from '../../middleware/auth'
import { authorize } from '../../middleware/roles'
import { json, error, serverError } from '../../utils/response'

const entrySchema = z
  .object({
    material_id: z.string().uuid(),
    quantity: z.number().refine((q) => q !== 0, 'La cantidad no puede ser cero'),
    order_id: z.string().uuid().nullable().optional(),
    type: z.enum(['entrada', 'salida', 'ajuste']).default('entrada'),
    notes: z.string().nullable().optional(),
  })
  .refine((d) => d.type === 'ajuste' || d.quantity > 0, {
    message: 'Las entradas y salidas requieren cantidad positiva',
    path: ['quantity'],
  })

export async function listEntries(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'inventory', res)) return

  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200)
  const offset = Math.max(Number(req.query.offset) || 0, 0)

  const { data, count, error: dbErr } = await supabase
    .from('inventory_entries')
    .select('*, materials(name, unit), orders(id, clients(company_name))', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (dbErr) return serverError(res, dbErr)
  res.setHeader('X-Total-Count', String(count ?? 0))
  return json(res, data)
}

export async function createEntry(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'inventory', res)) return

  const parsed = entrySchema.safeParse(req.body)
  if (!parsed.success) return error(res, parsed.error.message, 400)

  const { material_id, quantity, order_id, type, notes } = parsed.data

  const { data: material } = await supabase
    .from('materials')
    .select('id, name')
    .eq('id', material_id)
    .single()

  if (!material) return error(res, 'Material no encontrado', 404)

  // Movimiento + ajuste de stock en una sola transacción (atómico, sin
  // race conditions y sin que el historial diverja del stock).
  const { data: entry, error: entryErr } = await supabase.rpc('record_inventory_entry', {
    p_material_id: material_id,
    p_quantity: quantity,
    p_type: type,
    p_order_id: order_id || null,
    p_notes: notes || null,
    p_created_by: user.id,
  })

  if (entryErr) return serverError(res, entryErr)

  await supabase.from('activity_log').insert({
    user_id: user.id,
    action: 'inventory_entry',
    entity: 'inventory',
    entity_id: material_id,
    details: `${type}: ${quantity} unidades de ${material.name}${order_id ? ` (pedido ${order_id})` : ''}`,
  })

  return json(res, entry, 201)
}
