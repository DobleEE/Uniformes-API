import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import { supabase } from '../../db/supabase'
import { authenticate } from '../../middleware/auth'
import { authorize } from '../../middleware/roles'
import { json, error } from '../../utils/response'
import { parsePagination } from '../../utils/pagination'

const materialSchema = z.object({
  name: z.string().min(1),
  category: z.string().optional(),
  unit: z.string().min(1),
  min_stock: z.number().nonnegative().optional(),
  fabric_type: z.enum(['linea', 'temporada']).nullable().optional(),
  season: z.enum(['OI', 'PV']).nullable().optional(),
  season_year: z.number().int().nullable().optional(),
  color: z.string().nullable().optional(),
  code: z.string().nullable().optional(),
  piece_type: z.enum(['blusa', 'chaleco', 'pantalon', 'Ch/P']).nullable().optional(),
})

export async function listMaterials(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'materials', res)) return

  const { limit, offset } = parsePagination(req)

  const { data, count, error: dbErr } = await supabase
    .from('materials')
    .select('*, inventory(*)', { count: 'exact' })
    .order('name')
    .range(offset, offset + limit - 1)

  if (dbErr) return error(res, dbErr.message, 500)
  res.setHeader('X-Total-Count', String(count ?? 0))
  return json(res, data)
}

export async function createMaterial(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'materials', res)) return

  const parsed = materialSchema.safeParse(req.body)
  if (!parsed.success) return error(res, parsed.error.message, 400)

  const { data, error: dbErr } = await supabase
    .from('materials')
    .insert(parsed.data)
    .select()
    .single()

  if (dbErr) return error(res, dbErr.message, 500)

  // Crear registro de inventario con stock 0
  await supabase
    .from('inventory')
    .insert({ material_id: data.id, quantity_available: 0 })

  return json(res, data, 201)
}

export async function updateMaterial(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'materials', res)) return

  const { id } = (req as any).params
  const parsed = materialSchema.partial().safeParse(req.body)
  if (!parsed.success) return error(res, parsed.error.message, 400)

  const { data, error: dbErr } = await supabase
    .from('materials')
    .update(parsed.data)
    .eq('id', id)
    .select()
    .single()

  if (dbErr) return error(res, dbErr.message, 500)
  return json(res, data)
}

export async function deleteMaterial(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'materials', res)) return

  const { id } = (req as any).params
  const { error: dbErr } = await supabase
    .from('materials')
    .delete()
    .eq('id', id)

  if (dbErr) return error(res, dbErr.message, 500)
  return json(res, { success: true })
}
