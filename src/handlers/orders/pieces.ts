import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import { supabase } from '../../db/supabase'
import { authenticate } from '../../middleware/auth'
import { json, error } from '../../utils/response'

const statusSchema = z.object({
  status: z.enum(['por_terminar', 'terminada']),
  password: z.string().min(1, 'La contraseña es requerida'),
})

export async function listPieces(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return

  const { orderId } = (req as any).params

  const { data, error: dbErr } = await supabase
    .from('production_pieces')
    .select('*')
    .eq('order_id', orderId)
    .order('order_item_id')
    .order('piece_number')

  if (dbErr) return error(res, dbErr.message, 500)
  return json(res, data || [])
}

export async function generatePieces(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return

  if (user.role !== 'admin') {
    return error(res, 'Solo el administrador puede generar piezas', 403)
  }

  const { orderId } = (req as any).params

  // Verificar que no existan ya piezas
  const { data: existing } = await supabase
    .from('production_pieces')
    .select('id')
    .eq('order_id', orderId)
    .limit(1)

  if (existing && existing.length > 0) {
    return error(res, 'Las piezas ya fueron generadas para este pedido', 409)
  }

  // Obtener pedido con items y empleados
  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .select('*, order_items(*), employees(*)')
    .eq('id', orderId)
    .single()

  if (orderErr || !order) return error(res, 'Pedido no encontrado', 404)

  const employees: any[] = order.employees || []
  const pieces: any[] = []
  let empIndex = 0

  for (const item of order.order_items || []) {
    for (let i = 1; i <= item.quantity; i++) {
      const emp = employees[empIndex] || null
      pieces.push({
        order_id: orderId,
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

  if (pieces.length === 0) {
    return error(res, 'El pedido no tiene items para generar piezas', 400)
  }

  const { data, error: insertErr } = await supabase
    .from('production_pieces')
    .insert(pieces)
    .select()

  if (insertErr) return error(res, insertErr.message, 500)

  await supabase.from('activity_log').insert({
    user_id: user.id,
    action: 'generate_pieces',
    entity: 'production_pieces',
    entity_id: orderId,
    details: `${pieces.length} piezas generadas para pedido`,
  })

  return json(res, data, 201)
}

export async function updatePieceStatus(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return

  if (user.role !== 'admin' && user.role !== 'confeccion') {
    return error(res, 'Sin permisos para cambiar estado de piezas', 403)
  }

  const { id } = (req as any).params
  const parsed = statusSchema.safeParse(req.body)
  if (!parsed.success) return error(res, parsed.error.message, 400)

  // Verificar contraseña re-autenticando al usuario
  const { error: authErr } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: parsed.data.password,
  })

  if (authErr) {
    return error(res, 'Contraseña incorrecta', 401)
  }

  const { data, error: dbErr } = await supabase
    .from('production_pieces')
    .update({ status: parsed.data.status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (dbErr) return error(res, dbErr.message, 500)

  await supabase.from('activity_log').insert({
    user_id: user.id,
    action: 'update_status',
    entity: 'production_pieces',
    entity_id: id,
    details: `Pieza ${data.piece_number} marcada como ${parsed.data.status}`,
  })

  return json(res, data)
}
