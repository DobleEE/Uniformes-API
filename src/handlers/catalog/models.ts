import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import { supabase } from '../../db/supabase'
import { authenticate } from '../../middleware/auth'
import { authorize } from '../../middleware/roles'
import { json, error } from '../../utils/response'

const modelSchema = z.object({
  number: z.string().min(1),
  season: z.enum(['OI', 'PV']),
  season_year: z.number().int().min(2020).max(2099),
  blusa_material_id: z.string().uuid().nullable().optional(),
  chaleco_material_id: z.string().uuid().nullable().optional(),
  pantalon_material_id: z.string().uuid().nullable().optional(),
  active: z.boolean().optional(),
  notes: z.string().nullable().optional(),
})

const FABRIC_SELECT = 'id, name, code, color, fabric_type, season, season_year'

export async function listModels(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return

  let query = supabase
    .from('models')
    .select(`
      *,
      blusa_material:blusa_material_id(${FABRIC_SELECT}),
      chaleco_material:chaleco_material_id(${FABRIC_SELECT}),
      pantalon_material:pantalon_material_id(${FABRIC_SELECT})
    `)
    .order('season_year', { ascending: false })
    .order('season', { ascending: true })
    .order('number', { ascending: true })

  if (req.query.active === 'true') query = query.eq('active', true)

  const { data, error: dbErr } = await query
  if (dbErr) return error(res, dbErr.message, 500)
  return json(res, data)
}

export async function createModel(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'catalog', res)) return

  const parsed = modelSchema.safeParse(req.body)
  if (!parsed.success) return error(res, parsed.error.message, 400)

  const { data, error: dbErr } = await supabase
    .from('models')
    .insert(parsed.data)
    .select(`
      *,
      blusa_material:blusa_material_id(${FABRIC_SELECT}),
      chaleco_material:chaleco_material_id(${FABRIC_SELECT}),
      pantalon_material:pantalon_material_id(${FABRIC_SELECT})
    `)
    .single()

  if (dbErr) return error(res, dbErr.message, 500)
  return json(res, data, 201)
}

export async function updateModel(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'catalog', res)) return

  const { id } = (req as any).params
  const parsed = modelSchema.partial().safeParse(req.body)
  if (!parsed.success) return error(res, parsed.error.message, 400)

  const { data, error: dbErr } = await supabase
    .from('models')
    .update(parsed.data)
    .eq('id', id)
    .select(`
      *,
      blusa_material:blusa_material_id(${FABRIC_SELECT}),
      chaleco_material:chaleco_material_id(${FABRIC_SELECT}),
      pantalon_material:pantalon_material_id(${FABRIC_SELECT})
    `)
    .single()

  if (dbErr) return error(res, dbErr.message, 500)
  return json(res, data)
}

export async function deleteModel(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'catalog', res)) return

  const { id } = (req as any).params
  const { error: dbErr } = await supabase.from('models').delete().eq('id', id)
  if (dbErr) return error(res, dbErr.message, 500)
  return json(res, { success: true })
}
