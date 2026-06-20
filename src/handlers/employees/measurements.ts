import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import { supabase } from '../../db/supabase'
import { authenticate } from '../../middleware/auth'
import { authorize } from '../../middleware/roles'
import { json, error, serverError } from '../../utils/response'

const measurementSchema = z.object({
  chest: z.number().optional(),
  waist: z.number().optional(),
  hips: z.number().optional(),
  height: z.number().optional(),
  sleeve: z.number().optional(),
  shoulder: z.number().optional(),
  neck: z.number().optional(),
  inseam: z.number().optional(),
  notes: z.string().optional(),
})

export async function getMeasurements(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'measurements', res, 'read')) return

  const { employeeId } = (req as any).params
  const { data, error: dbErr } = await supabase
    .from('measurements')
    .select('*')
    .eq('employee_id', employeeId)
    .single()

  if (dbErr) return error(res, 'Medidas no encontradas', 404)
  return json(res, data)
}

export async function upsertMeasurements(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'measurements', res)) return

  const { employeeId } = (req as any).params
  const parsed = measurementSchema.safeParse(req.body)
  if (!parsed.success) return error(res, parsed.error.message, 400)

  const { data, error: dbErr } = await supabase
    .from('measurements')
    .upsert(
      { ...parsed.data, employee_id: employeeId },
      { onConflict: 'employee_id' }
    )
    .select()
    .single()

  if (dbErr) return serverError(res, dbErr)
  return json(res, data)
}
