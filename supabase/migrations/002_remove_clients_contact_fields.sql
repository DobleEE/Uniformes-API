-- Eliminar columnas phone y email de la tabla principal de clientes
-- ya que la información de contacto pasa a manejarse exclusivamente en client_contacts
ALTER TABLE clients DROP COLUMN IF EXISTS phone;
ALTER TABLE clients DROP COLUMN IF EXISTS email;
