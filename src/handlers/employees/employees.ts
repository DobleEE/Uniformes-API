import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import { supabase } from '../../db/supabase'
import { authenticate } from '../../middleware/auth'
import { authorize } from '../../middleware/roles'
import { json, error, serverError } from '../../utils/response'

const employeeSchema = z.object({
  name: z.string().min(1),
  department: z.string().optional(),
  position: z.string().optional(),
})

export async function listEmployees(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'employees', res, 'read')) return

  const { orderId } = (req as any).params
  const { data, error: dbErr } = await supabase
    .from('employees')
    .select('*, measurements(*)')
    .eq('order_id', orderId)
    .order('name')

  if (dbErr) return serverError(res, dbErr)
  return json(res, data)
}

export async function getEmployee(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'employees', res, 'read')) return

  const { id } = (req as any).params
  const { data, error: dbErr } = await supabase
    .from('employees')
    .select('*, measurements(*), orders(*, clients(company_name))')
    .eq('id', id)
    .single()

  if (dbErr) return error(res, 'Empleado no encontrado', 404)
  return json(res, data)
}

export async function createEmployee(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'employees', res)) return

  const { orderId } = (req as any).params
  const parsed = employeeSchema.safeParse(req.body)
  if (!parsed.success) return error(res, parsed.error.message, 400)

  const { data, error: dbErr } = await supabase
    .from('employees')
    .insert({ ...parsed.data, order_id: orderId })
    .select()
    .single()

  if (dbErr) return serverError(res, dbErr)
  return json(res, data, 201)
}

export async function updateEmployee(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'employees', res)) return

  const { id } = (req as any).params
  const parsed = employeeSchema.partial().safeParse(req.body)
  if (!parsed.success) return error(res, parsed.error.message, 400)

  const { data, error: dbErr } = await supabase
    .from('employees')
    .update(parsed.data)
    .eq('id', id)
    .select()
    .single()

  if (dbErr) return serverError(res, dbErr)
  return json(res, data)
}

export async function deleteEmployee(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'employees', res)) return

  const { id } = (req as any).params
  const { error: dbErr } = await supabase
    .from('employees')
    .delete()
    .eq('id', id)

  if (dbErr) return serverError(res, dbErr)
  return json(res, { success: true })
}
