-- Migración 005: Tipo de pieza para telas
ALTER TABLE materials ADD COLUMN IF NOT EXISTS piece_type text CHECK (piece_type IN ('blusa', 'chaleco', 'pantalon', 'Ch/P'));
