import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import { supabase } from '../../db/supabase'
import { authenticate } from '../../middleware/auth'
import { authorize } from '../../middleware/roles'
import { json, error } from '../../utils/response'

const updateSchema = z.object({
  quantity_available: z.number().nonnegative(),
})

export async function getInventory(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'inventory', res)) return

  const [{ data, error: dbErr }, { data: activeItems }] = await Promise.all([
    supabase
      .from('inventory')
      .select('*, materials(*)')
      .order('materials(name)'),
    supabase
      .from('order_items')
      .select('fabric_id, orders!inner(status)')
      .not('fabric_id', 'is', null),
  ])

  if (dbErr) return error(res, dbErr.message, 500)

  const activeFabricIds = new Set(
    (activeItems || [])
      .filter((item: any) => !['entregado', 'cancelado'].includes(item.orders?.status))
      .map((item: any) => item.fabric_id)
  )

  const enriched = (data || []).map((item: any) => ({
    ...item,
    low_stock:
      item.materials?.min_stock != null &&
      item.quantity_available <= item.materials.min_stock &&
      activeFabricIds.has(item.material_id),
  }))

  return json(res, enriched)
}

export async function updateInventory(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'inventory', res)) return

  const { materialId } = (req as any).params
  const parsed = updateSchema.safeParse(req.body)
  if (!parsed.success) return error(res, parsed.error.message, 400)

  const newQty = parsed.data.quantity_available

  // Leer cantidad actual para calcular delta y registrar la entrada
  const { data: current } = await supabase
    .from('inventory')
    .select('quantity_available')
    .eq('material_id', materialId)
    .single()

  const currentQty = Number(current?.quantity_available ?? 0)
  const delta = newQty - currentQty

  const { data, error: dbErr } = await supabase
    .from('inventory')
    .update({ quantity_available: newQty })
    .eq('material_id', materialId)
    .select()
    .single()

  if (dbErr) return error(res, dbErr.message, 500)

  // Registrar el movimiento en el historial solo si hubo cambio
  if (delta !== 0) {
    await supabase.from('inventory_entries').insert({
      material_id: materialId,
      quantity: Math.abs(delta),
      type: delta > 0 ? 'ajuste' : 'salida',
      notes: 'Ajuste manual de inventario',
      created_by: user.id,
    })
  }

  await supabase.from('activity_log').insert({
    user_id: user.id,
    action: 'update',
    entity: 'inventory',
    entity_id: materialId,
    details: `Inventario ajustado de ${currentQty} a ${newQty}`,
  })

  return json(res, data)
}
