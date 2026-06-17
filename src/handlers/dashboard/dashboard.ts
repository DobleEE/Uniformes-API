import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabase } from '../../db/supabase'
import { authenticate } from '../../middleware/auth'
import { authorize } from '../../middleware/roles'
import { json, error } from '../../utils/response'

export async function getDashboard(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'dashboard', res)) return

  const now = new Date()
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  const INACTIVE_STATUSES = ['entregado', 'cancelado']

  const [
    ordersInProd,
    ordersDelivered,
    ordersPending,
    lowStock,
    activeOrderItems,
    recentActivity,
    monthlyRevenue,
  ] = await Promise.all([
    // Pedidos en produccion
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'en_produccion'),

    // Pedidos entregados este mes
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'entregado')
      .gte('created_at', firstOfMonth),

    // Pedidos pendientes (cotización o aprobado)
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .in('status', ['cotizacion', 'aprobado']),

    // Materiales con stock bajo
    supabase
      .from('inventory')
      .select('material_id, quantity_available, materials(name, min_stock)')
      .not('materials.min_stock', 'is', null),

    // Telas usadas en pedidos activos (no entregados ni cancelados)
    supabase
      .from('order_items')
      .select('fabric_id, orders!inner(status)')
      .not('fabric_id', 'is', null),

    // Actividad reciente
    supabase
      .from('activity_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10),

    // Ingresos del mes (total_price de pedidos entregados)
    supabase
      .from('orders')
      .select('total_price')
      .eq('status', 'entregado')
      .gte('created_at', firstOfMonth),
  ])

  const activeFabricIds = new Set(
    (activeOrderItems.data || [])
      .filter((item: any) => !INACTIVE_STATUSES.includes(item.orders?.status))
      .map((item: any) => item.fabric_id)
  )

  const lowStockItems = (lowStock.data || []).filter(
    (item: any) =>
      item.materials?.min_stock != null &&
      item.quantity_available <= item.materials.min_stock &&
      activeFabricIds.has(item.material_id)
  )

  const revenue = (monthlyRevenue.data || []).reduce(
    (sum: number, o: any) => sum + (o.total_price || 0),
    0
  )

  return json(res, {
    orders_in_production: ordersInProd.count || 0,
    orders_delivered_this_month: ordersDelivered.count || 0,
    orders_pending: ordersPending.count || 0,
    low_stock_count: lowStockItems.length,
    low_stock_items: lowStockItems.slice(0, 5),
    monthly_revenue: revenue,
    recent_activity: recentActivity.data || [],
  })
}
