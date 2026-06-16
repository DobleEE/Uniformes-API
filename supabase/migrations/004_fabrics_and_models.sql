-- =============================================
-- Migración 004: Telas, Modelos y rediseño de order_items
-- =============================================

-- 1. Extender tabla materials con campos de tela
ALTER TABLE materials ADD COLUMN IF NOT EXISTS fabric_type text CHECK (fabric_type IN ('linea', 'temporada'));
ALTER TABLE materials ADD COLUMN IF NOT EXISTS season text CHECK (season IN ('OI', 'PV'));
ALTER TABLE materials ADD COLUMN IF NOT EXISTS season_year int;
ALTER TABLE materials ADD COLUMN IF NOT EXISTS color text;
ALTER TABLE materials ADD COLUMN IF NOT EXISTS code text;

-- 2. Tabla de Modelos / Maquetas
CREATE TABLE IF NOT EXISTS models (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  number text NOT NULL,
  season text NOT NULL CHECK (season IN ('OI', 'PV')),
  season_year int NOT NULL,
  blusa_material_id uuid REFERENCES materials(id) ON DELETE SET NULL,
  chaleco_material_id uuid REFERENCES materials(id) ON DELETE SET NULL,
  pantalon_material_id uuid REFERENCES materials(id) ON DELETE SET NULL,
  active boolean DEFAULT true,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE models ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated access models" ON models FOR ALL TO authenticated USING (true);

CREATE INDEX idx_models_season ON models(season, season_year);
CREATE INDEX idx_models_active ON models(active);

-- 3. Nuevos campos en order_items
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS piece_type text;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS fabric_id uuid REFERENCES materials(id) ON DELETE SET NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS model_id uuid REFERENCES models(id) ON DELETE SET NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS item_notes text;
