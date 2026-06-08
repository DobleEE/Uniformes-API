import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import { supabase } from '../../db/supabase'
import { authenticate } from '../../middleware/auth'
import { authorize, hasPermission } from '../../middleware/roles'
import { json, error } from '../../utils/response'

const orderSchema = z.object({
  client_id: z.string().uuid(),
  delivery_date: z.string().optional(),
  notes: z.string().optional(),
})

const statusSchema = z.object({
  status: z.enum([
    'cotizacion',
    'aprobado',
    'anticipo_pagado',
    'en_produccion',
    'terminado',
    'entregado',
    'cancelado',
  ]),
  password: z.string().min(1, 'La contraseña es requerida'),
})

export async function listOrders(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'orders', res)) return

  let query = supabase
    .from('orders')
    .select('*, clients(company_name), order_items(*)')
    .order('created_at', { ascending: false })

  // Filtros opcionales
  const status = req.query.status as string
  if (status) query = query.eq('status', status)

  const excludeStatus = req.query.exclude_status as string
  if (excludeStatus) {
    excludeStatus.split(',').forEach((s) => {
      query = query.neq('status', s.trim())
    })
  }

  const clientId = req.query.client_id as string
  if (clientId) query = query.eq('client_id', clientId)

  const { data, error: dbErr } = await query

  if (dbErr) return error(res, dbErr.message, 500)
  return json(res, data)
}

export async function getOrder(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'orders', res)) return

  const { id } = (req as any).params
  const { data, error: dbErr } = await supabase
    .from('orders')
    .select('*, clients(company_name, email, phone), order_items(*), employees(*, measurements(*))')
    .eq('id', id)
    .single()

  if (dbErr) return error(res, 'Pedido no encontrado', 404)
  return json(res, data)
}

export async function createOrder(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'orders', res)) return

  const parsed = orderSchema.safeParse(req.body)
  if (!parsed.success) return error(res, parsed.error.message, 400)

  const { data, error: dbErr } = await supabase
    .from('orders')
    .insert({
      ...parsed.data,
      status: 'cotizacion',
      total_price: 0,
      advance_payment: 0,
      created_by: user.id,
    })
    .select()
    .single()

  if (dbErr) return error(res, dbErr.message, 500)

  // Log de actividad
  await supabase.from('activity_log').insert({
    user_id: user.id,
    action: 'create',
    entity: 'orders',
    entity_id: data.id,
    details: `Pedido creado para cliente ${parsed.data.client_id}`,
  })

  return json(res, data, 201)
}

export async function updateOrder(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'orders', res)) return

  const { id } = (req as any).params
  const body = req.body || {}

  const { data, error: dbErr } = await supabase
    .from('orders')
    .update({
      ...(body.delivery_date && { delivery_date: body.delivery_date }),
      ...(body.notes !== undefined && { notes: body.notes }),
      ...(body.advance_payment !== undefined && { advance_payment: body.advance_payment }),
      ...(body.total_price !== undefined && { total_price: body.total_price }),
    })
    .eq('id', id)
    .select()
    .single()

  if (dbErr) return error(res, dbErr.message, 500)
  return json(res, data)
}

export async function updateOrderStatus(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return

  // Confección solo puede actualizar status
  if (!hasPermission(user, 'orders', 'update_status') && !hasPermission(user, 'orders', 'write')) {
    if (!authorize(user, 'orders', res)) return
  }

  const { id } = (req as any).params
  const parsed = statusSchema.safeParse(req.body)
  if (!parsed.success) return error(res, 'Status o contraseña invalidos', 400)

  // Verificar contraseña re-autenticando al usuario
  const { error: authErr } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: parsed.data.password,
  })

  if (authErr) {
    return error(res, 'Contraseña incorrecta', 401)
  }

  const { data, error: dbErr } = await supabase
    .from('orders')
    .update({ status: parsed.data.status })
    .eq('id', id)
    .select()
    .single()

  if (dbErr) return error(res, dbErr.message, 500)

  // Auto-generar piezas al entrar en producción
  if (parsed.data.status === 'en_produccion') {
    const { data: existing } = await supabase
      .from('production_pieces')
      .select('id')
      .eq('order_id', id)
      .limit(1)

    if (!existing || existing.length === 0) {
      const { data: order } = await supabase
        .from('orders')
        .select('*, order_items(*), employees(*)')
        .eq('id', id)
        .single()

      if (order) {
        const employees: any[] = order.employees || []
        const pieces: any[] = []
        let empIndex = 0

        for (const item of order.order_items || []) {
          for (let i = 1; i <= item.quantity; i++) {
            const emp = employees[empIndex] || null
            pieces.push({
              order_id: id,
              order_item_id: item.id,
              piece_number: i,
              employee_id: emp?.id || null,
              employee_name: emp?.name || null,
              uniform_type: item.uniform_type,
              status: 'por_terminar',
            })
            if (emp) empIndex++
          }
        }

        if (pieces.length > 0) {
          await supabase.from('production_pieces').insert(pieces)
        }
      }
    }
  }

  await supabase.from('activity_log').insert({
    user_id: user.id,
    action: 'update_status',
    entity: 'orders',
    entity_id: id,
    details: `Status cambiado a ${parsed.data.status}`,
  })

  return json(res, data)
}
