import type { VercelRequest, VercelResponse } from '@vercel/node'
import path from 'path'
import fs from 'fs'
import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
import { z } from 'zod'
import { authenticate } from '../../middleware/auth'
import { authorize } from '../../middleware/roles'
import { error } from '../../utils/response'

const itemSchema = z.object({
  cantidad: z.number().int().positive(),
  descripcion: z.string().min(1),
  precio_unitario: z.number().nonnegative(),
})

const quoteSchema = z.object({
  cliente_nombre: z.string().min(1),
  temporada_label: z.string().min(1),
  fecha: z.string().optional(),
  items: z.array(itemSchema).min(1),
})

const fmt = (n: number) =>
  `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtDate = (iso: string) =>
  new Date(iso + (iso.length === 10 ? 'T12:00:00' : ''))
    .toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })

export async function generateStandaloneQuotation(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'orders', res, 'read')) return

  const parsed = quoteSchema.safeParse(req.body)
  if (!parsed.success) return error(res, parsed.error.message, 400)

  const { cliente_nombre, temporada_label, fecha, items } = parsed.data

  const templatePath = path.join(process.cwd(), 'templates', 'cotizacion.docx')
  if (!fs.existsSync(templatePath)) {
    return error(res, 'Plantilla de cotización no encontrada en templates/cotizacion.docx', 503)
  }

  const content = fs.readFileSync(templatePath, 'binary')
  const zip = new PizZip(content)
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true })

  const fechaStr = fecha ? fmtDate(fecha) : fmtDate(new Date().toISOString().slice(0, 10))

  const enrichedItems = items.map((item) => ({
    cantidad: String(item.cantidad),
    descripcion: item.descripcion,
    precio_unitario: fmt(item.precio_unitario),
    subtotal: fmt(item.cantidad * item.precio_unitario),
  }))

  const total = items.reduce((acc, i) => acc + i.cantidad * i.precio_unitario, 0)

  doc.setData({
    fecha: fechaStr,
    cliente_nombre,
    temporada_label,
    items: enrichedItems,
    total: fmt(total),
  })

  try {
    doc.render()
  } catch (renderErr: any) {
    const msg = renderErr?.properties?.errors?.map((e: any) => e.message).join(', ')
    return error(res, `Error al procesar la plantilla: ${msg || renderErr.message}`, 500)
  }

  const buf = doc.getZip().generate({ type: 'nodebuffer' })
  const safeName = cliente_nombre.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30)
  const filename = `Cotizacion-${safeName}-${new Date().toISOString().slice(0, 10)}.docx`

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition')
  return res.status(200).send(buf)
}
