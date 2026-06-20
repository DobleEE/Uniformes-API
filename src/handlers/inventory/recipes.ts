import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import { supabase } from '../../db/supabase'
import { authenticate } from '../../middleware/auth'
import { authorize } from '../../middleware/roles'
import { json, error, serverError } from '../../utils/response'

const recipeSchema = z.object({
  uniform_type: z.string().min(1),
  material_id: z.string().uuid(),
  quantity_required: z.number().positive(),
})

export async function listRecipes(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'inventory', res)) return

  let query = supabase
    .from('uniform_recipes')
    .select('*, materials(name, unit)')
    .order('uniform_type')

  const uniformType = req.query.uniform_type as string
  if (uniformType) query = query.eq('uniform_type', uniformType)

  const { data, error: dbErr } = await query
  if (dbErr) return serverError(res, dbErr)
  return json(res, data)
}

export async function upsertRecipe(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'inventory', res)) return

  const parsed = recipeSchema.safeParse(req.body)
  if (!parsed.success) return error(res, parsed.error.message, 400)

  const { data, error: dbErr } = await supabase
    .from('uniform_recipes')
    .upsert(parsed.data, {
      onConflict: 'uniform_type,material_id',
    })
    .select()
    .single()

  if (dbErr) return serverError(res, dbErr)
  return json(res, data)
}

export async function deleteRecipe(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'inventory', res)) return

  const { id } = (req as any).params
  const { error: dbErr } = await supabase
    .from('uniform_recipes')
    .delete()
    .eq('id', id)

  if (dbErr) return serverError(res, dbErr)
  return json(res, { success: true })
}
