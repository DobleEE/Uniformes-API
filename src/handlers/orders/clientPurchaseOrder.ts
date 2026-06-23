import type { VercelRequest, VercelResponse } from '@vercel/node'
import path from 'path'
import fs from 'fs'
import PizZip from 'pizzip'
import { supabase } from '../../db/supabase'
import { authenticate } from '../../middleware/auth'
import { authorize } from '../../middleware/roles'
import { error } from '../../utils/response'

// ── XML helpers ──────────────────────────────────────────────────────────────

function escXml(s: string | number | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Split-based approach: more reliable than global-regex counting.
// After split('</si>'), each element contains one <si>…<t>…</t> block (no closing tag).
// We find the last <si> in that element and overwrite from there to the end.
function replaceSharedString(ssXml: string, index: number, newText: string): string {
  const parts = ssXml.split('</si>')
  if (index >= parts.length - 1) return ssXml
  const siPos = parts[index].lastIndexOf('<si>')
  if (siPos === -1) return ssXml
  parts[index] =
    parts[index].substring(0, siPos) +
    `<si><t xml:space="preserve">${escXml(newText)}</t>`
  return parts.join('</si>')
}

function countSharedStrings(ssXml: string): number {
  return ssXml.split('</si>').length - 1
}

function appendSharedStrings(ssXml: string, newStrings: string[]): { xml: string; startIdx: number } {
  const startIdx = countSharedStrings(ssXml)
  if (newStrings.length === 0) return { xml: ssXml, startIdx }
  const parts = ssXml.split('</si>')
  const newParts = newStrings.map((s) => `<si><t xml:space="preserve">${escXml(s)}</t>`)
  // Insert before the last element (which is the content after the final </si>, i.e. '</sst>')
  parts.splice(parts.length - 1, 0, ...newParts)
  const total = startIdx + newStrings.length
  let xml = parts.join('</si>')
  xml = xml.replace(/count="\d+"/, `count="${total}"`)
  xml = xml.replace(/uniqueCount="\d+"/, `uniqueCount="${total}"`)
  return { xml, startIdx }
}

// ── Row builders ─────────────────────────────────────────────────────────────

function itemRow(
  rowNum: number,
  quantity: number,
  pieceIdx: number,
  modelIdx: number,
  unitPrice: number,
  isFirst: boolean,
): string {
  const r = rowNum
  const ht = isFirst ? 'ht="19.5"' : 'ht="21"'
  const aStyle = isFirst ? 's="29"' : 's="5"'
  const sub = quantity * unitPrice
  return (
    `<row r="${r}" spans="1:9" ${ht} customHeight="1" x14ac:dyDescent="0.25">` +
    `<c r="A${r}" ${aStyle}><v>${quantity}</v></c>` +
    `<c r="B${r}" s="33" t="s"><v>${pieceIdx}</v></c>` +
    `<c r="C${r}" s="33"/>` +
    `<c r="D${r}" s="33"/>` +
    `<c r="E${r}" s="33"/>` +
    `<c r="F${r}" s="37" t="s"><v>${modelIdx}</v></c>` +
    `<c r="G${r}" s="37"/>` +
    `<c r="H${r}" s="6"><v>${unitPrice}</v></c>` +
    `<c r="I${r}" s="7"><f>A${r}*H${r}</f><v>${sub}</v></c>` +
    `</row>`
  )
}

function emptyRow(rowNum: number, isFirst: boolean): string {
  const r = rowNum
  const ht = isFirst ? 'ht="19.5"' : 'ht="21"'
  const aStyle = isFirst ? 's="29"' : 's="5"'
  return (
    `<row r="${r}" spans="1:9" ${ht} customHeight="1" x14ac:dyDescent="0.25">` +
    `<c r="A${r}" ${aStyle}/>` +
    `<c r="B${r}" s="33"/>` +
    `<c r="C${r}" s="33"/>` +
    `<c r="D${r}" s="33"/>` +
    `<c r="E${r}" s="33"/>` +
    `<c r="F${r}" s="37"/>` +
    `<c r="G${r}" s="37"/>` +
    `<c r="H${r}" s="6"/>` +
    `<c r="I${r}" s="7"><f>A${r}*H${r}</f><v>0</v></c>` +
    `</row>`
  )
}

// ── Main handler ─────────────────────────────────────────────────────────────

export async function generateClientPurchaseOrder(req: VercelRequest, res: VercelResponse) {
  const user = await authenticate(req, res)
  if (!user) return
  if (!authorize(user, 'orders', res, 'read')) return

  const { id } = (req as any).params

  const { data: order, error: dbErr } = await supabase
    .from('orders')
    .select('*, order_items(*, fabric:fabric_id(name, code, color), model:model_id(number, season, season_year))')
    .eq('id', id)
    .single()

  if (dbErr || !order) return error(res, 'Pedido no encontrado', 404)

  // Fetch client + contacts separately to avoid nested-join ambiguity
  let client: any = {}
  let contacts: any[] = []
  if (order.client_id) {
    const { data: clientData } = await supabase
      .from('clients')
      .select('*, client_contacts(*)')
      .eq('id', order.client_id)
      .single()
    if (clientData) {
      client = clientData
      contacts = Array.isArray(clientData.client_contacts) ? clientData.client_contacts : []
    }
  }

  const templatePath = path.join(process.cwd(), 'templates', 'plantilla_ordenCompra.xlsx')
  if (!fs.existsSync(templatePath)) {
    return error(res, 'Plantilla no encontrada: templates/plantilla_ordenCompra.xlsx', 503)
  }

  const zip = new PizZip(fs.readFileSync(templatePath))
  let ssXml   = zip.file('xl/sharedStrings.xml')!.asText()
  let sheetXml = zip.file('xl/worksheets/sheet1.xml')!.asText()

  // ── Data preparation ──────────────────────────────────────────────────────

  const contact: any = contacts[0] || {}
  const items: any[] = Array.isArray(order.order_items) ? (order.order_items as any[]).slice(0, 10) : []

  const up = (s: unknown) => String(s ?? '').toUpperCase().trim()

  const fmtDate = (iso: string) => {
    const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso)
    return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' }).toUpperCase()
  }

  const SEASON_LABELS: Record<string, string> = { OI: 'OTOÑO/INVIERNO', PV: 'PRIMAVERA/VERANO' }
  const seasonLabel = SEASON_LABELS[order.season as string] ?? up(order.season || 'TEMPORADA')
  const dateStr     = order.created_at ? fmtDate(order.created_at as string) : ''
  const companyName = up(client.company_name)
  const contactName = up(contact.name)
  const contactPos  = up(contact.position)
  const address     = up(client.address)
  const phone       = String(contact.phone ?? '').trim()
  const email       = String(contact.email ?? '').toLowerCase().trim()

  const infoLines = String(order.additional_info ?? '').split('\n').map((l: string) => up(l))
  while (infoLines.length < 3) infoLines.push('')

  console.log('[PO] order id:', id)
  console.log('[PO] client:', companyName, '| contact:', contactName, '| season:', seasonLabel)
  console.log('[PO] items:', items.length)

  // ── Replace shared strings ────────────────────────────────────────────────
  //
  // Index → cell → data
  //  19   → E5   → temporada
  //  20   → B8   → empresa
  //  21   → B9   → contacto (nombre)
  //  22   → B10  → puesto
  //  23   → B11  → dirección
  //  27   → G10  → teléfono
  //  29   → G11  → email
  //  30   → G8   → fecha
  //  31   → G9   → ciudad
  //  41   → A25  → info adicional línea 2
  //  43   → A26  → info adicional línea 3
  //  44   → A24  → info adicional línea 1

  const staticReplacements: [number, string][] = [
    [19, seasonLabel],
    [20, companyName],
    [21, contactName],
    [22, contactPos],
    [23, address],
    [27, phone],
    [29, email],
    [30, dateStr],
    [31, 'CD. OBREGÓN, SONORA'],
    [41, infoLines[1]],
    [43, infoLines[2]],
    [44, infoLines[0]],
  ]

  const totalBefore = countSharedStrings(ssXml)
  console.log('[PO] shared strings in template:', totalBefore)

  for (const [idx, val] of staticReplacements) {
    ssXml = replaceSharedString(ssXml, idx, val)
  }

  console.log('[PO] shared strings after static replacements:', countSharedStrings(ssXml))

  // ── Add new shared strings for item rows ──────────────────────────────────

  const newStrings: string[] = []
  for (const item of items) {
    const pieceLabel = up(item.uniform_type || item.piece_type || '')
    const fabricPart = item.fabric ? up(item.fabric.name) : ''
    newStrings.push(fabricPart ? `${pieceLabel} · ${fabricPart}` : pieceLabel)

    const modelRef = item.model
      ? `MOD. #${item.model.number} ${item.model.season ?? ''}${item.model.season_year ?? ''}`
      : up(item.item_notes || '')
    newStrings.push(modelRef)
  }

  const { xml: ss2, startIdx } = appendSharedStrings(ssXml, newStrings)
  ssXml = ss2
  console.log('[PO] shared strings after item additions:', countSharedStrings(ssXml), '| startIdx:', startIdx)

  // ── Build item rows 14-23 ─────────────────────────────────────────────────

  let newItemRows = ''
  for (let i = 0; i < 10; i++) {
    const rowNum = 14 + i
    const item = items[i]
    if (item) {
      const pieceIdx = startIdx + i * 2
      const modelIdx = startIdx + i * 2 + 1
      newItemRows += itemRow(rowNum, Number(item.quantity), pieceIdx, modelIdx, Number(item.price_per_unit), i === 0)
    } else {
      newItemRows += emptyRow(rowNum, i === 0)
    }
  }

  // Replace rows 14–23 block
  const r14Start = sheetXml.indexOf('<row r="14"')
  const r24Start = sheetXml.indexOf('<row r="24"')
  console.log('[PO] row14 pos:', r14Start, '| row24 pos:', r24Start)

  if (r14Start !== -1 && r24Start !== -1) {
    sheetXml = sheetXml.substring(0, r14Start) + newItemRows + sheetXml.substring(r24Start)
  }

  // ── Financial values ──────────────────────────────────────────────────────

  const subtotal = items.reduce((s: number, i: any) => s + Number(i.quantity) * Number(i.price_per_unit), 0)
  const applyIva = order.apply_iva !== false
  const iva      = applyIva ? subtotal * 0.16 : 0
  const total    = subtotal + iva
  const anticipo = total * 0.5

  // I27 is empty in the template — add ANTICIPO (50% of total)
  sheetXml = sheetXml.replace(
    '<c r="I27" s="25"/>',
    `<c r="I27" s="25"><f>+I26*0.5</f><v>${anticipo}</v></c>`,
  )

  if (!applyIva) {
    // Replace IVA formula with 0
    sheetXml = sheetXml.replace(
      /<c r="I25"[^>]*>[\s\S]*?<\/c>/,
      `<c r="I25" s="23"><f>0</f><v>0</v></c>`,
    )
  }

  // ── Delivery info ─────────────────────────────────────────────────────────

  if (order.delivery_days) {
    const deliveryStr = `${order.delivery_days} DÍAS HÁBILES`
    const { xml: ss3, startIdx: di } = appendSharedStrings(ssXml, [deliveryStr])
    ssXml = ss3
    // G34 is the delivery value cell (label is in A35, not F34 based on template)
    sheetXml = sheetXml.replace(
      /(<row r="34"[^>]*>)([\s\S]*?)(<\/row>)/,
      (_m, open, inner, close) => {
        if (!inner.includes('r="G34"')) {
          inner += `<c r="G34" s="0" t="s"><v>${di}</v></c>`
        }
        return open + inner + close
      },
    )
  }

  // ── Write back ────────────────────────────────────────────────────────────

  zip.file('xl/sharedStrings.xml', ssXml)
  zip.file('xl/worksheets/sheet1.xml', sheetXml)

  const buffer = zip.generate({ type: 'nodebuffer' })
  const safeName = String(client.company_name || 'cliente').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20)
  const filename = `OrdenCompra-${safeName}-${new Date().toISOString().slice(0, 10)}.xlsx`

  console.log('[PO] generated buffer size:', buffer.length)

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition')
  return res.status(200).send(buffer)
}
