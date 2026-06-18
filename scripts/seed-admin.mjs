import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Leer .env.local
const envPath = resolve(__dirname, '../.env')
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => l.split('=').map(s => s.trim()))
    .map(([k, ...v]) => [k, v.join('=')])
)

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const EMAIL = 'davidaescarcega@gmail.com'

// Buscar el usuario por email
const { data: { users }, error: listError } = await supabase.auth.admin.listUsers()
if (listError) { console.error('Error listando usuarios:', listError.message); process.exit(1) }

const user = users.find(u => u.email === EMAIL)
if (!user) { console.error(`Usuario ${EMAIL} no encontrado en Supabase Auth`); process.exit(1) }

console.log(`Usuario encontrado: ${user.id}`)

// Insertar en app_users
const { error: insertError } = await supabase
  .from('app_users')
  .upsert({ id: user.id, email: user.email, role: 'admin' })

if (insertError) { console.error('Error insertando en app_users:', insertError.message); process.exit(1) }

console.log(`✅ Usuario ${EMAIL} insertado con rol admin`)
