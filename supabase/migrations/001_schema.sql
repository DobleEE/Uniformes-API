-- =============================================
-- UNIFORMES - Esquema completo de base de datos
-- =============================================

-- 1. Usuarios del sistema (vinculados a auth.users de Supabase)
create table app_users (
  id uuid references auth.users(id) on delete cascade primary key,
  email text not null,
  role text not null check (role in ('admin', 'ventas', 'almacen', 'confeccion')),
  name text,
  created_at timestamptz default now()
);

alter table app_users enable row level security;
create policy "Users can read own data" on app_users for select using (auth.uid() = id);
create policy "Service role full access" on app_users for all using (true);

-- 2. Clientes
create table clients (
  id uuid default gen_random_uuid() primary key,
  company_name text not null,
  address text,
  industry text,
  created_at timestamptz default now()
);

alter table clients enable row level security;
create policy "Authenticated users can read clients" on clients for select to authenticated using (true);
create policy "Authenticated users can insert clients" on clients for insert to authenticated with check (true);
create policy "Authenticated users can update clients" on clients for update to authenticated using (true);
create policy "Authenticated users can delete clients" on clients for delete to authenticated using (true);

-- 3. Contactos del cliente
create table client_contacts (
  id uuid default gen_random_uuid() primary key,
  client_id uuid references clients(id) on delete cascade not null,
  name text not null,
  position text,
  phone text,
  email text,
  created_at timestamptz default now()
);

alter table client_contacts enable row level security;
create policy "Authenticated access contacts" on client_contacts for all to authenticated using (true);

-- 4. Pedidos / Ordenes
create table orders (
  id uuid default gen_random_uuid() primary key,
  client_id uuid references clients(id) on delete restrict not null,
  status text not null default 'cotizacion' check (
    status in ('cotizacion', 'aprobado', 'anticipo_pagado', 'en_produccion', 'terminado', 'entregado', 'cancelado')
  ),
  total_price numeric(12,2) default 0,
  advance_payment numeric(12,2) default 0,
  delivery_date date,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

alter table orders enable row level security;
create policy "Authenticated access orders" on orders for all to authenticated using (true);

-- 5. Items del pedido
create table order_items (
  id uuid default gen_random_uuid() primary key,
  order_id uuid references orders(id) on delete cascade not null,
  uniform_type text not null,
  quantity integer not null check (quantity > 0),
  price_per_unit numeric(10,2) not null default 0,
  created_at timestamptz default now()
);

alter table order_items enable row level security;
create policy "Authenticated access order_items" on order_items for all to authenticated using (true);

-- 6. Empleados del cliente (asociados a un pedido)
create table employees (
  id uuid default gen_random_uuid() primary key,
  order_id uuid references orders(id) on delete cascade not null,
  name text not null,
  department text,
  position text,
  created_at timestamptz default now()
);

alter table employees enable row level security;
create policy "Authenticated access employees" on employees for all to authenticated using (true);

-- 7. Medidas
create table measurements (
  id uuid default gen_random_uuid() primary key,
  employee_id uuid references employees(id) on delete cascade not null unique,
  chest numeric(6,2),
  waist numeric(6,2),
  hips numeric(6,2),
  height numeric(6,2),
  sleeve numeric(6,2),
  shoulder numeric(6,2),
  neck numeric(6,2),
  inseam numeric(6,2),
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table measurements enable row level security;
create policy "Authenticated access measurements" on measurements for all to authenticated using (true);

-- 8. Materiales
create table materials (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  category text,
  unit text not null, -- metros, piezas, rollos, etc.
  min_stock numeric(10,2) default 0,
  created_at timestamptz default now()
);

alter table materials enable row level security;
create policy "Authenticated access materials" on materials for all to authenticated using (true);

-- 9. Inventario
create table inventory (
  material_id uuid references materials(id) on delete cascade primary key,
  quantity_available numeric(10,2) default 0,
  updated_at timestamptz default now()
);

alter table inventory enable row level security;
create policy "Authenticated access inventory" on inventory for all to authenticated using (true);

-- 10. Recetas de uniformes (BOM - Bill of Materials)
create table uniform_recipes (
  id uuid default gen_random_uuid() primary key,
  uniform_type text not null,
  material_id uuid references materials(id) on delete cascade not null,
  quantity_required numeric(10,4) not null check (quantity_required > 0),
  unique(uniform_type, material_id)
);

alter table uniform_recipes enable row level security;
create policy "Authenticated access recipes" on uniform_recipes for all to authenticated using (true);

-- 11. Proveedores
create table suppliers (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  phone text,
  email text,
  address text,
  created_at timestamptz default now()
);

alter table suppliers enable row level security;
create policy "Authenticated access suppliers" on suppliers for all to authenticated using (true);

-- 12. Ordenes de compra a proveedores
create table purchase_orders (
  id uuid default gen_random_uuid() primary key,
  supplier_id uuid references suppliers(id) on delete restrict not null,
  status text not null default 'pendiente' check (
    status in ('pendiente', 'enviada', 'recibida', 'cancelada')
  ),
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

alter table purchase_orders enable row level security;
create policy "Authenticated access purchase_orders" on purchase_orders for all to authenticated using (true);

-- 13. Items de orden de compra
create table purchase_order_items (
  id uuid default gen_random_uuid() primary key,
  purchase_order_id uuid references purchase_orders(id) on delete cascade not null,
  material_id uuid references materials(id) on delete restrict not null,
  quantity numeric(10,2) not null check (quantity > 0),
  unit_price numeric(10,2),
  created_at timestamptz default now()
);

alter table purchase_order_items enable row level security;
create policy "Authenticated access po_items" on purchase_order_items for all to authenticated using (true);

-- 14. Log de actividad (auditoría)
create table activity_log (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id),
  action text not null,
  entity text not null,
  entity_id uuid,
  details text,
  created_at timestamptz default now()
);

alter table activity_log enable row level security;
create policy "Authenticated can read activity_log" on activity_log for select to authenticated using (true);
create policy "Authenticated can insert activity_log" on activity_log for insert to authenticated with check (true);

-- =============================================
-- INDICES para rendimiento
-- =============================================
create index idx_orders_client_id on orders(client_id);
create index idx_orders_status on orders(status);
create index idx_orders_created_at on orders(created_at);
create index idx_order_items_order_id on order_items(order_id);
create index idx_employees_order_id on employees(order_id);
create index idx_measurements_employee_id on measurements(employee_id);
create index idx_client_contacts_client_id on client_contacts(client_id);
create index idx_uniform_recipes_type on uniform_recipes(uniform_type);
create index idx_purchase_orders_supplier on purchase_orders(supplier_id);
create index idx_purchase_order_items_po on purchase_order_items(purchase_order_id);
create index idx_activity_log_entity on activity_log(entity, entity_id);
create index idx_activity_log_created on activity_log(created_at);
