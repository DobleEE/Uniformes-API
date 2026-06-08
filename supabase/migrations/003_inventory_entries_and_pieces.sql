-- =============================================
-- Migración 003: Entradas de inventario y piezas de producción
-- =============================================

-- Entradas de inventario (movimientos con trazabilidad por pedido)
create table inventory_entries (
  id uuid default gen_random_uuid() primary key,
  material_id uuid references materials(id) on delete restrict not null,
  quantity numeric(10,2) not null check (quantity > 0),
  order_id uuid references orders(id) on delete set null,
  type text not null default 'entrada' check (type in ('entrada', 'salida', 'ajuste')),
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

alter table inventory_entries enable row level security;
create policy "Authenticated access inventory_entries" on inventory_entries for all to authenticated using (true);

create index idx_inventory_entries_material on inventory_entries(material_id);
create index idx_inventory_entries_order on inventory_entries(order_id);
create index idx_inventory_entries_created on inventory_entries(created_at);

-- Piezas individuales de producción por item de pedido
create table production_pieces (
  id uuid default gen_random_uuid() primary key,
  order_id uuid references orders(id) on delete cascade not null,
  order_item_id uuid references order_items(id) on delete cascade not null,
  piece_number integer not null,
  employee_id uuid references employees(id) on delete set null,
  employee_name text,
  uniform_type text not null,
  status text not null default 'por_terminar' check (status in ('por_terminar', 'terminada')),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(order_item_id, piece_number)
);

alter table production_pieces enable row level security;
create policy "Authenticated access production_pieces" on production_pieces for all to authenticated using (true);

create index idx_production_pieces_order on production_pieces(order_id);
create index idx_production_pieces_item on production_pieces(order_item_id);
create index idx_production_pieces_status on production_pieces(status);
