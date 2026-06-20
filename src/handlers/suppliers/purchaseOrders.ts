import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import { supabase } from '../../db/supabase'
import { authenticate } from '../../middleware/auth'
import { authorize } from '../../middleware/roles'
import { json, error, serverError } from '../../utils/response'
import { parsePagination } from '../../utils/pagination'

const purchaseOrderSchema = z.object({
  supplier_id: z.string().uuid(),
  order_id: z.string().uuid().optional(),
  items: z.array(
    z.object({
      material_id: z.string().uuid(),
      quantity: z.number().positive(),
      unit_price: z.number().nonnegative().optional(),
    })
  ),
})

const statusSchema = z.object({
  status: z.enum(['pendiente', 'enviada', 'recibida', 'cancelada']),
})

export async function listPurchaseOrders(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'purchase_orders', res)) return

  const { limit, offset } = parsePagination(req)

  let query = supabase
    .from('purchase_orders')
    .select('*, suppliers(name), purchase_order_items(*, materials(name, unit))', { count: 'exact' })
    .order('created_at', { ascending: false })

  const orderId = req.query.order_id as string
  if (orderId) query = query.eq('order_id', orderId)

  const { data, count, error: dbErr } = await query.range(offset, offset + limit - 1)
  if (dbErr) return serverError(res, dbErr)
  res.setHeader('X-Total-Count', String(count ?? 0))
  return json(res, data)
}

export async function listOrderPurchaseOrders(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'purchase_orders', res)) return

  const { orderId } = (req as any).params

  const { data, error: dbErr } = await supabase
    .from('purchase_orders')
    .select('*, suppliers(name), purchase_order_items(*, materials(name, unit))')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })

  if (dbErr) return serverError(res, dbErr)
  return json(res, data)
}

export async function createPurchaseOrder(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'purchase_orders', res)) return

  const parsed = purchaseOrderSchema.safeParse(req.body)
  if (!parsed.success) return error(res, parsed.error.message, 400)

  if (parsed.data.items.length === 0) {
    return error(res, 'La orden de compra debe tener al menos un item', 400)
  }

  // Cabecera + items en una sola transacción (evita órdenes huérfanas).
  const { data: po, error: poErr } = await supabase.rpc('create_purchase_order', {
    p_supplier_id: parsed.data.supplier_id,
    p_order_id: parsed.data.order_id || null,
    p_items: parsed.data.items,
    p_created_by: user.id,
  })

  if (poErr) return serverError(res, poErr)

  const { data: full } = await supabase
    .from('purchase_orders')
    .select('*, suppliers(name), purchase_order_items(*, materials(name, unit))')
    .eq('id', po.id)
    .single()

  await supabase.from('activity_log').insert({
    user_id: user.id,
    action: 'create',
    entity: 'purchase_orders',
    entity_id: po.id,
    details: `Orden de compra creada para proveedor ${parsed.data.supplier_id}`,
  })

  return json(res, full, 201)
}

export async function updatePurchaseOrderStatus(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'purchase_orders', res)) return

  const { id } = (req as any).params
  const parsed = statusSchema.safeParse(req.body)
  if (!parsed.success) return error(res, 'Status invalido', 400)

  // Recepción: idempotente y atómica (status + entradas + stock en una sola
  // transacción; re-recibir NO vuelve a sumar inventario). Ver migración 010.
  if (parsed.data.status === 'recibida') {
    const { error: rpcErr } = await supabase.rpc('receive_purchase_order', {
      p_po_id: id,
      p_user_id: user.id,
    })
    if (rpcErr) return serverError(res, rpcErr)

    await supabase.from('activity_log').insert({
      user_id: user.id,
      action: 'receive',
      entity: 'purchase_orders',
      entity_id: id,
      details: 'Orden recibida - inventario actualizado',
    })
  } else {
    const { error: dbErr } = await supabase
      .from('purchase_orders')
      .update({ status: parsed.data.status })
      .eq('id', id)
    if (dbErr) return serverError(res, dbErr)
  }

  const { data, error: fetchErr } = await supabase
    .from('purchase_orders')
    .select('*, purchase_order_items(*)')
    .eq('id', id)
    .single()

  if (fetchErr) return serverError(res, fetchErr)
  return json(res, data)
}
