import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabase } from '../../db/supabase'
import { authenticate } from '../../middleware/auth'
import { authorize } from '../../middleware/roles'
import { json, error, serverError } from '../../utils/response'

interface MaterialCheck {
  material_id: string
  material_name: string
  unit: string
  quantity_needed: number
  quantity_available: number
  sufficient: boolean
  shortage: number
}

export async function checkOrderMaterials(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'inventory', res)) return

  const { orderId } = (req as any).params

  // Obtener items del pedido
  const { data: items, error: itemsErr } = await supabase
    .from('order_items')
    .select('uniform_type, quantity')
    .eq('order_id', orderId)

  if (itemsErr) return serverError(res, itemsErr)
  if (!items || items.length === 0) {
    return json(res, { checks: [], can_produce: true })
  }

  // Obtener recetas para cada tipo de uniforme
  const uniformTypes = [...new Set(items.map((i) => i.uniform_type))]
  const { data: recipes } = await supabase
    .from('uniform_recipes')
    .select('*, materials(name, unit)')
    .in('uniform_type', uniformTypes)

  if (!recipes || recipes.length === 0) {
    return json(res, {
      checks: [],
      can_produce: false,
      message: 'No hay recetas definidas para estos tipos de uniforme',
    })
  }

  // Calcular material necesario
  const materialNeeds: Record<string, { needed: number; name: string; unit: string }> = {}

  for (const item of items) {
    const itemRecipes = recipes.filter((r) => r.uniform_type === item.uniform_type)
    for (const recipe of itemRecipes) {
      const mid = recipe.material_id
      if (!materialNeeds[mid]) {
        materialNeeds[mid] = {
          needed: 0,
          name: (recipe as any).materials?.name || mid,
          unit: (recipe as any).materials?.unit || '',
        }
      }
      materialNeeds[mid].needed += recipe.quantity_required * item.quantity
    }
  }

  // Obtener inventario actual
  const materialIds = Object.keys(materialNeeds)
  const { data: inventory } = await supabase
    .from('inventory')
    .select('material_id, quantity_available')
    .in('material_id', materialIds)

  const inventoryMap: Record<string, number> = {}
  for (const inv of inventory || []) {
    inventoryMap[inv.material_id] = inv.quantity_available
  }

  // Generar reporte
  const checks: MaterialCheck[] = materialIds.map((mid) => {
    const needed = materialNeeds[mid].needed
    const available = inventoryMap[mid] || 0
    const shortage = Math.max(0, needed - available)
    return {
      material_id: mid,
      material_name: materialNeeds[mid].name,
      unit: materialNeeds[mid].unit,
      quantity_needed: needed,
      quantity_available: available,
      sufficient: available >= needed,
      shortage,
    }
  })

  const canProduce = checks.every((c) => c.sufficient)

  return json(res, { checks, can_produce: canProduce })
}
