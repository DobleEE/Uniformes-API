import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import { supabase } from '../../db/supabase'
import { authenticate } from '../../middleware/auth'
import { authorize, hasPermission } from '../../middleware/roles'
import { json, error, serverError } from '../../utils/response'
import { parsePagination } from '../../utils/pagination'

const orderSchema = z.object({
  client_id: z.string().uuid(),
  delivery_date: z.string().optional(),
  notes: z.string().optional(),
  season: z.string().optional(),
  delivery_days: z.number().int().positive().optional(),
  measurements_date: z.string().optional(),
  apply_iva: z.boolean().optional(),
  additional_info: z.string().optional(),
})

const updateOrderSchema = z.object({
  delivery_date: z.string().nullable().optional(),
  notes: z.string().optional(),
  advance_payment: z.number().nonnegative().optional(),
  total_price: z.number().nonnegative().optional(),
  season: z.string().optional(),
  delivery_days: z.number().int().positive().optional(),
  measurements_date: z.string().nullable().optional(),
  apply_iva: z.boolean().optional(),
  additional_info: z.string().optional(),
})

type OrderStatus =
  | 'cotizacion'
  | 'aprobado'
  | 'anticipo_pagado'
  | 'en_produccion'
  | 'terminado'
  | 'entregado'
  | 'cancelado'

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

// Máquina de estados: transiciones permitidas desde cada status.
// Evita saltos arbitrarios (p. ej. cotizacion -> entregado) y reaperturas.
const STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  cotizacion: ['aprobado', 'cancelado'],
  aprobado: ['anticipo_pagado', 'cancelado'],
  anticipo_pagado: ['en_produccion', 'cancelado'],
  en_produccion: ['terminado', 'cancelado'],
  terminado: ['entregado'],
  entregado: [],
  cancelado: [],
}

// Status que el rol 'confeccion' puede establecer (solo avance de producción).
const CONFECCION_ALLOWED_TARGETS: OrderStatus[] = ['terminado']

export async function listOrders(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'orders', res, 'read')) return

  const { limit, offset } = parsePagination(req)

  let query = supabase
    .from('orders')
    .select('*, clients(company_name), order_items(*)', { count: 'exact' })
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

  const { data, count, error: dbErr } = await query.range(offset, offset + limit - 1)

  if (dbErr) return serverError(res, dbErr)
  res.setHeader('X-Total-Count', String(count ?? 0))
  return json(res, data)
}

export async function getOrder(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'orders', res, 'read')) return

  const { id } = (req as any).params
  const { data, error: dbErr } = await supabase
    .from('orders')
    .select('*, clients(company_name), order_items(*, fabric:fabric_id(id, name, code, color), model:model_id(id, number, season, season_year)), employees(*, measurements(*))')
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

  if (dbErr) return serverError(res, dbErr)

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
  const parsed = updateOrderSchema.safeParse(req.body)
  if (!parsed.success) return error(res, parsed.error.message, 400)

  const d = parsed.data
  const updates: Record<string, unknown> = {}
  if (d.delivery_date !== undefined) updates.delivery_date = d.delivery_date ?? null
  if (d.notes !== undefined) updates.notes = d.notes
  if (d.advance_payment !== undefined) updates.advance_payment = d.advance_payment
  if (d.total_price !== undefined) updates.total_price = d.total_price
  if (d.season !== undefined) updates.season = d.season
  if (d.delivery_days !== undefined) updates.delivery_days = d.delivery_days
  if (d.measurements_date !== undefined) updates.measurements_date = d.measurements_date ?? null
  if (d.apply_iva !== undefined) updates.apply_iva = d.apply_iva
  if (d.additional_info !== undefined) updates.additional_info = d.additional_info

  if (Object.keys(updates).length === 0) {
    return error(res, 'No hay campos para actualizar', 400)
  }

  const { data, error: dbErr } = await supabase
    .from('orders')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (dbErr) return serverError(res, dbErr)
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

  const targetStatus = parsed.data.status as OrderStatus

  // Validar la transición contra el estado actual del pedido
  const { data: currentOrder, error: currentErr } = await supabase
    .from('orders')
    .select('status')
    .eq('id', id)
    .single()

  if (currentErr || !currentOrder) return error(res, 'Pedido no encontrado', 404)

  const currentStatus = currentOrder.status as OrderStatus
  if (currentStatus !== targetStatus) {
    const allowed = STATUS_TRANSITIONS[currentStatus] ?? []
    if (!allowed.includes(targetStatus)) {
      return error(res, `Transición de estado no permitida: ${currentStatus} → ${targetStatus}`, 409)
    }
  }

  // El rol confección solo puede avanzar la producción (no entregar/cancelar)
  if (
    user.role === 'confeccion' &&
    !hasPermission(user, 'orders', 'write') &&
    !CONFECCION_ALLOWED_TARGETS.includes(targetStatus)
  ) {
    return error(res, 'Tu rol no puede establecer este estado', 403)
  }

  // Verificar contraseña e invalidar la sesión nueva de inmediato
  const { data: verifyData, error: authErr } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: parsed.data.password,
  })

  if (authErr || !verifyData.session) {
    return error(res, 'Contraseña incorrecta', 401)
  }

  await supabase.auth.admin.signOut(verifyData.session.access_token)

  const { data, error: dbErr } = await supabase
    .from('orders')
    .update({ status: parsed.data.status })
    .eq('id', id)
    .select()
    .single()

  if (dbErr) return serverError(res, dbErr)

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
              uniform_type: item.piece_type || item.uniform_type,
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
