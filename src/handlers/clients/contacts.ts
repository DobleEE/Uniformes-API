import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import { supabase } from '../../db/supabase'
import { authenticate } from '../../middleware/auth'
import { authorize } from '../../middleware/roles'
import { json, error, serverError } from '../../utils/response'

const contactSchema = z.object({
  name: z.string().min(1),
  position: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
})

export async function listContacts(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'client_contacts', res)) return

  const { clientId } = (req as any).params
  const { data, error: dbErr } = await supabase
    .from('client_contacts')
    .select('*')
    .eq('client_id', clientId)
    .order('name')

  if (dbErr) return serverError(res, dbErr)
  return json(res, data)
}

export async function createContact(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'client_contacts', res)) return

  const { clientId } = (req as any).params
  const parsed = contactSchema.safeParse(req.body)
  if (!parsed.success) return error(res, parsed.error.message, 400)

  const { data, error: dbErr } = await supabase
    .from('client_contacts')
    .insert({ ...parsed.data, client_id: clientId })
    .select()
    .single()

  if (dbErr) return serverError(res, dbErr)
  return json(res, data, 201)
}

export async function updateContact(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'client_contacts', res)) return

  const { id } = (req as any).params
  const parsed = contactSchema.partial().safeParse(req.body)
  if (!parsed.success) return error(res, parsed.error.message, 400)

  const { data, error: dbErr } = await supabase
    .from('client_contacts')
    .update(parsed.data)
    .eq('id', id)
    .select()
    .single()

  if (dbErr) return serverError(res, dbErr)
  return json(res, data)
}

export async function deleteContact(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'client_contacts', res)) return

  const { id } = (req as any).params
  const { error: dbErr } = await supabase
    .from('client_contacts')
    .delete()
    .eq('id', id)

  if (dbErr) return serverError(res, dbErr)
  return json(res, { success: true })
}
