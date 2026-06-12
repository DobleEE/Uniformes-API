import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import { supabase } from '../../db/supabase'
import { authenticate } from '../../middleware/auth'
import { authorize } from '../../middleware/roles'
import { json, error } from '../../utils/response'

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

  let query = supabase
    .from('purchase_orders')
    .select('*, suppliers(name), purchase_order_items(*, materials(name, unit))')
    .order('created_at', { ascending: false })

  const orderId = req.query.order_id as string
  if (orderId) query = query.eq('order_id', orderId)

  const { data, error: dbErr } = await query
  if (dbErr) return error(res, dbErr.message, 500)
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

  if (dbErr) return error(res, dbErr.message, 500)
  return json(res, data)
}

export async function createPurchaseOrder(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'purchase_orders', res)) return

  const parsed = purchaseOrderSchema.safeParse(req.body)
  if (!parsed.success) return error(res, parsed.error.message, 400)

  const { data: po, error: poErr } = await supabase
    .from('purchase_orders')
    .insert({
      supplier_id: parsed.data.supplier_id,
      order_id: parsed.data.order_id || null,
      status: 'pendiente',
      created_by: user.id,
    })
    .select()
    .single()

  if (poErr) return error(res, poErr.message, 500)

  const items = parsed.data.items.map((item) => ({
    ...item,
    purchase_order_id: po.id,
  }))

  const { error: itemsErr } = await supabase
    .from('purchase_order_items')
    .insert(items)

  if (itemsErr) return error(res, itemsErr.message, 500)

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

  const { data, error: dbErr } = await supabase
    .from('purchase_orders')
    .update({ status: parsed.data.status })
    .eq('id', id)
    .select('*, purchase_order_items(*)')
    .single()

  if (dbErr) return error(res, dbErr.message, 500)

  if (parsed.data.status === 'recibida' && data.purchase_order_items) {
    for (const item of data.purchase_order_items as any[]) {
      const { data: inv } = await supabase
        .from('inventory')
        .select('quantity_available')
        .eq('material_id', item.material_id)
        .single()

      const currentQty = inv?.quantity_available || 0
      await supabase.from('inventory').upsert({
        material_id: item.material_id,
        quantity_available: currentQty + item.quantity,
      })

      await supabase.from('inventory_entries').insert({
        material_id: item.material_id,
        quantity: item.quantity,
        type: 'entrada',
        order_id: (data as any).order_id || null,
        notes: 'Recepción de orden de compra',
        created_by: user.id,
      })
    }

    await supabase.from('activity_log').insert({
      user_id: user.id,
      action: 'receive',
      entity: 'purchase_orders',
      entity_id: id,
      details: 'Orden recibida - inventario actualizado',
    })
  }

  return json(res, data)
}
