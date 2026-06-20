-- =============================================
-- Migración 010: Escrituras atómicas e idempotentes
-- Corrige (auditoría #2 y #3):
--   - Movimiento de inventario + ajuste de stock en una sola transacción.
--   - Upsert del inventario cuando el material aún no tiene fila.
--   - Recepción de orden de compra idempotente (no infla el stock al
--     re-recibir) y atómica (status + entradas + stock juntos).
-- =============================================

-- 1. Registrar un movimiento de inventario y ajustar el stock atómicamente.
--    delta: entrada/ajuste = +quantity, salida = -quantity.
--    (en 'ajuste', quantity puede ser negativo; ver migración 009)
create or replace function record_inventory_entry(
  p_material_id uuid,
  p_quantity    numeric,
  p_type        text,
  p_order_id    uuid    default null,
  p_notes       text    default null,
  p_created_by  uuid    default null
)
returns inventory_entries
language plpgsql
set search_path = public
as $$
declare
  v_entry inventory_entries;
  v_delta numeric;
begin
  insert into inventory_entries (material_id, quantity, type, order_id, notes, created_by)
  values (p_material_id, p_quantity, p_type, p_order_id, p_notes, p_created_by)
  returning * into v_entry;

  v_delta := case when p_type = 'salida' then -p_quantity else p_quantity end;

  insert into inventory (material_id, quantity_available, updated_at)
  values (p_material_id, greatest(0, v_delta), now())
  on conflict (material_id) do update
    set quantity_available = greatest(0, inventory.quantity_available + v_delta),
        updated_at         = now();

  return v_entry;
end;
$$;

-- 2. Recibir una orden de compra de forma idempotente y atómica.
--    Si ya está 'recibida', no vuelve a sumar stock (no-op idempotente).
create or replace function receive_purchase_order(
  p_po_id     uuid,
  p_user_id   uuid
)
returns purchase_orders
language plpgsql
set search_path = public
as $$
declare
  v_po       purchase_orders;
  v_item     record;
begin
  -- Bloquea la fila para evitar recepciones concurrentes duplicadas
  select * into v_po from purchase_orders where id = p_po_id for update;

  if not found then
    raise exception 'Orden de compra no encontrada' using errcode = 'P0002';
  end if;

  -- Idempotencia: si ya estaba recibida, no se ajusta inventario otra vez
  if v_po.status = 'recibida' then
    return v_po;
  end if;

  update purchase_orders set status = 'recibida' where id = p_po_id returning * into v_po;

  for v_item in
    select material_id, quantity from purchase_order_items where purchase_order_id = p_po_id
  loop
    perform record_inventory_entry(
      v_item.material_id,
      v_item.quantity,
      'entrada',
      v_po.order_id,
      'Recepción de orden de compra',
      p_user_id
    );
  end loop;

  return v_po;
end;
$$;

-- (auditoría #7) Columna para registrar la IP de origen en eventos de auth,
-- permitiendo rate limiting por IP además de por email.
alter table activity_log add column if not exists ip text;
create index if not exists idx_activity_log_ip_created on activity_log(ip, created_at);

-- Fijar search_path en funciones de inventario (cierra el lint
-- function_search_path_mutable de Supabase). Incluye la de la migración 006.
alter function adjust_inventory_quantity(uuid, numeric) set search_path = public;

-- 3. Crear una orden de compra (cabecera + items) atómicamente.
--    Evita órdenes huérfanas si falla la inserción de items.
--    p_items: jsonb array de { material_id, quantity, unit_price }
create or replace function create_purchase_order(
  p_supplier_id uuid,
  p_order_id    uuid,
  p_items       jsonb,
  p_created_by  uuid
)
returns purchase_orders
language plpgsql
set search_path = public
as $$
declare
  v_po purchase_orders;
begin
  insert into purchase_orders (supplier_id, order_id, status, created_by)
  values (p_supplier_id, p_order_id, 'pendiente', p_created_by)
  returning * into v_po;

  insert into purchase_order_items (purchase_order_id, material_id, quantity, unit_price)
  select
    v_po.id,
    (item->>'material_id')::uuid,
    (item->>'quantity')::numeric,
    nullif(item->>'unit_price', '')::numeric
  from jsonb_array_elements(p_items) as item;

  return v_po;
end;
$$;
