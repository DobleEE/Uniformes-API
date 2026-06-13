import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabase } from '../../db/supabase'
import { authenticate } from '../../middleware/auth'
import { authorize } from '../../middleware/roles'
import { json, error } from '../../utils/response'

const VALID_STATUSES = ['nueva', 'vista', 'contactada', 'convertida']

export async function listLandingContacts(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'landing_contacts', res)) return

  const { status } = req.query
  let query = supabase
    .from('landing_contacts')
    .select('*')
    .order('created_at', { ascending: false })

  if (status && typeof status === 'string' && VALID_STATUSES.includes(status)) {
    query = query.eq('status', status)
  }

  const { data, error: err } = await query
  if (err) return error(res, err.message)
  return json(res, data)
}

export async function updateLandingContactStatus(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'landing_contacts', res)) return

  const { id } = (req as any).params
  const { status } = req.body

  if (!VALID_STATUSES.includes(status)) {
    return error(res, 'Estado invalido', 400)
  }

  const { data, error: err } = await supabase
    .from('landing_contacts')
    .update({ status })
    .eq('id', id as string)
    .select()
    .single()

  if (err) return error(res, err.message)
  return json(res, data)
}
