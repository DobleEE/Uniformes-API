import type { VercelResponse } from '@vercel/node'
import type { AuthUser, UserRole } from './auth'
import { error } from '../utils/response'

// Permisos por rol
const permissions: Record<UserRole, string[]> = {
  admin: ['*'],
  ventas: [
    'clients',
    'client_contacts',
    'orders',
    'order_items',
    'employees',
    'measurements',
    'catalog',
    'landing_contacts',
    'dashboard',
  ],
  almacen: [
    'materials',
    'inventory',
    'suppliers',
    'purchase_orders',
    'purchase_order_items',
    'catalog',
    'dashboard',
  ],
  confeccion: ['orders:read', 'employees:read', 'measurements:read', 'orders:update_status'],
}

export function authorize(
  user: AuthUser,
  resource: string,
  res: VercelResponse,
  action: string = 'write'
): boolean {
  const userPerms = permissions[user.role]

  if (userPerms.includes('*')) return true
  if (userPerms.includes(resource)) return true
  if (userPerms.includes(`${resource}:${action}`)) return true

  error(res, 'No tienes permisos para esta accion', 403)
  return false
}

export function hasPermission(user: AuthUser, resource: string, action: string): boolean {
  const userPerms = permissions[user.role]
  if (userPerms.includes('*')) return true
  if (userPerms.includes(resource)) return true
  if (userPerms.includes(`${resource}:${action}`)) return true
  return false
}
