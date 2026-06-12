import { get, post, put, del, patch } from './router'

// Auth
import { login } from '../handlers/auth/login'
import { me } from '../handlers/auth/me'

// Clients
import { listClients, getClient, createClient, updateClient, deleteClient } from '../handlers/clients/clients'
import { listContacts, createContact, updateContact, deleteContact } from '../handlers/clients/contacts'

// Orders
import { listOrders, getOrder, createOrder, updateOrder, updateOrderStatus } from '../handlers/orders/orders'
import { listOrderItems, createOrderItem, updateOrderItem, deleteOrderItem } from '../handlers/orders/orderItems'

// Employees & Measurements
import { listEmployees, getEmployee, createEmployee, updateEmployee, deleteEmployee } from '../handlers/employees/employees'
import { getMeasurements, upsertMeasurements } from '../handlers/employees/measurements'

// Inventory
import { listMaterials, createMaterial, updateMaterial, deleteMaterial } from '../handlers/inventory/materials'
import { getInventory, updateInventory } from '../handlers/inventory/inventory'
import { listRecipes, upsertRecipe, deleteRecipe } from '../handlers/inventory/recipes'
import { checkOrderMaterials } from '../handlers/inventory/check'
import { listEntries, createEntry } from '../handlers/inventory/entries'

// Production pieces
import { listPieces, generatePieces, updatePieceStatus } from '../handlers/orders/pieces'

// Quotation
import { generateQuotation } from '../handlers/orders/quotation'

// Suppliers
import { listSuppliers, createSupplier, updateSupplier, deleteSupplier } from '../handlers/suppliers/suppliers'
import { listPurchaseOrders, createPurchaseOrder, updatePurchaseOrderStatus, listOrderPurchaseOrders } from '../handlers/suppliers/purchaseOrders'

// Landing contacts
import { listLandingContacts, updateLandingContactStatus } from '../handlers/landing/contacts'

// Dashboard
import { getDashboard } from '../handlers/dashboard/dashboard'

export function registerRoutes() {
  // Auth
  post('/api/auth/login', login)
  get('/api/auth/me', me)

  // Clients
  get('/api/clients', listClients)
  get('/api/clients/:id', getClient)
  post('/api/clients', createClient)
  put('/api/clients/:id', updateClient)
  del('/api/clients/:id', deleteClient)

  // Client contacts
  get('/api/clients/:clientId/contacts', listContacts)
  post('/api/clients/:clientId/contacts', createContact)
  put('/api/contacts/:id', updateContact)
  del('/api/contacts/:id', deleteContact)

  // Orders
  get('/api/orders', listOrders)
  get('/api/orders/:id', getOrder)
  post('/api/orders', createOrder)
  put('/api/orders/:id', updateOrder)
  patch('/api/orders/:id/status', updateOrderStatus)

  // Order items
  get('/api/orders/:orderId/items', listOrderItems)
  post('/api/orders/:orderId/items', createOrderItem)
  put('/api/order-items/:id', updateOrderItem)
  del('/api/order-items/:id', deleteOrderItem)

  // Employees
  get('/api/orders/:orderId/employees', listEmployees)
  get('/api/employees/:id', getEmployee)
  post('/api/orders/:orderId/employees', createEmployee)
  put('/api/employees/:id', updateEmployee)
  del('/api/employees/:id', deleteEmployee)

  // Measurements
  get('/api/employees/:employeeId/measurements', getMeasurements)
  put('/api/employees/:employeeId/measurements', upsertMeasurements)

  // Materials
  get('/api/materials', listMaterials)
  post('/api/materials', createMaterial)
  put('/api/materials/:id', updateMaterial)
  del('/api/materials/:id', deleteMaterial)

  // Inventory — rutas específicas ANTES de las parametrizadas
  get('/api/inventory', getInventory)
  get('/api/inventory/entries', listEntries)
  post('/api/inventory/entries', createEntry)
  patch('/api/inventory/:materialId', updateInventory)

  // Recipes (BOM)
  get('/api/recipes', listRecipes)
  put('/api/recipes', upsertRecipe)
  del('/api/recipes/:id', deleteRecipe)

  // Material check for orders
  get('/api/orders/:orderId/check-materials', checkOrderMaterials)

  // Production pieces
  get('/api/orders/:orderId/pieces', listPieces)
  post('/api/orders/:orderId/pieces/generate', generatePieces)
  patch('/api/pieces/:id/status', updatePieceStatus)

  // Quotation document
  get('/api/orders/:id/quotation', generateQuotation)

  // Suppliers
  get('/api/suppliers', listSuppliers)
  post('/api/suppliers', createSupplier)
  put('/api/suppliers/:id', updateSupplier)
  del('/api/suppliers/:id', deleteSupplier)

  // Purchase orders
  get('/api/orders/:orderId/purchase-orders', listOrderPurchaseOrders)
  get('/api/purchase-orders', listPurchaseOrders)
  post('/api/purchase-orders', createPurchaseOrder)
  patch('/api/purchase-orders/:id/status', updatePurchaseOrderStatus)

  // Landing contacts
  get('/api/landing-contacts', listLandingContacts)
  patch('/api/landing-contacts/:id/status', updateLandingContactStatus)

  // Dashboard
  get('/api/dashboard', getDashboard)
}
