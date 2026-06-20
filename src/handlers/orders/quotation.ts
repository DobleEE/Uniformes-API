import type { VercelRequest, VercelResponse } from '@vercel/node'
import path from 'path'
import fs from 'fs'
import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
import { supabase } from '../../db/supabase'
import { authenticate } from '../../middleware/auth'
import { authorize } from '../../middleware/roles'
import { error } from '../../utils/response'

export async function generateQuotation(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'orders', res, 'read')) return

  const { id } = (req as any).params

  const { data: order, error: dbErr } = await supabase
    .from('orders')
    .select('*, clients(*), order_items(*, fabric:fabric_id(name, code), model:model_id(number, season, season_year))')
    .eq('id', id)
    .single()

  if (dbErr || !order) return error(res, 'Pedido no encontrado', 404)

  const templatePath = path.join(process.cwd(), 'templates', 'cotizacion.docx')

  if (!fs.existsSync(templatePath)) {
    return error(
      res,
      'Plantilla de cotización no configurada. Ejecuta: npx ts-node scripts/setup-template.ts',
      503
    )
  }

  const content = fs.readFileSync(templatePath, 'binary')
  const zip = new PizZip(content)
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true })

  const total = Number(order.total_price) || 0
  const anticipo = Number(order.advance_payment) || 0
  const saldo = total - anticipo

  const fmt = (n: number) =>
    `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const fmtDate = (iso: string) =>
    new Date(iso + (iso.length === 10 ? 'T12:00:00' : ''))
      .toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })

  doc.setData({
    folio: order.id.slice(0, 8).toUpperCase(),
    fecha: fmtDate(order.created_at),
    fecha_entrega: order.delivery_date ? fmtDate(order.delivery_date) : 'Por definir',
    cliente_empresa: order.clients?.company_name || '',
    cliente_dir: order.clients?.address || '',
    cliente_tel: '',
    cliente_email: '',
    notas: order.notes || '',
    total: fmt(total),
    anticipo: fmt(anticipo),
    saldo: fmt(saldo),
    items: (order.order_items || []).map((item: any) => {
      const pieceLabel = item.piece_type || item.uniform_type || ''
      const modelLabel = item.model
        ? `Mod. #${item.model.number} ${item.model.season}${item.model.season_year}`
        : ''
      const fabricLabel = item.fabric ? item.fabric.name : ''
      const tipoUniforme = [pieceLabel, modelLabel, fabricLabel].filter(Boolean).join(' · ')
      return {
        tipo_uniforme: tipoUniforme || pieceLabel,
        tela: fabricLabel,
        modelo: modelLabel,
        cantidad: String(item.quantity),
        precio_unitario: fmt(Number(item.price_per_unit)),
        subtotal: fmt(item.quantity * Number(item.price_per_unit)),
        observaciones: item.item_notes || '',
      }
    }),
  })

  try {
    doc.render()
  } catch (renderErr: any) {
    const msg = renderErr?.properties?.errors?.map((e: any) => e.message).join(', ')
    return error(res, `Error al procesar la plantilla: ${msg || renderErr.message}`, 500)
  }

  const buf = doc.getZip().generate({ type: 'nodebuffer' })
  const filename = `Cotizacion-${order.id.slice(0, 8).toUpperCase()}.docx`

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition')
  return res.status(200).send(buf)
}
