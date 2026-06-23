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

// Replace the nth <si>…</si> block (0-indexed) in sharedStrings XML
function replaceSi(ssXml: string, targetIdx: number, newText: string): string {
  let count = 0
  return ssXml.replace(/<si>[\s\S]*?<\/si>/g, (match) => {
    if (count === targetIdx) {
      count++
      return `<si><t xml:space="preserve">${escXml(newText)}</t></si>`
    }
    count++
    return match
  })
}

function countSi(ssXml: string): number {
  return (ssXml.match(/<\/si>/g) || []).length
}

function addSharedStrings(ssXml: string, newStrings: string[]): { xml: string; startIdx: number } {
  const startIdx = countSi(ssXml)
  const newSi = newStrings.map((s) => `<si><t xml:space="preserve">${escXml(s)}</t></si>`).join('')
  const total = startIdx + newStrings.length
  let xml = ssXml
    .replace('</sst>', newSi + '</sst>')
    .replace(/count="\d+"/, `count="${total}"`)
    .replace(/uniqueCount="\d+"/, `uniqueCount="${total}"`)
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
    .select(
      '*, clients(*, client_contacts(*)), order_items(*, fabric:fabric_id(name, code), model:model_id(number, season, season_year))',
    )
    .eq('id', id)
    .single()

  if (dbErr || !order) return error(res, 'Pedido no encontrado', 404)

  const templatePath = path.join(process.cwd(), 'templates', 'plantilla_ordenCompra.xlsx')
  if (!fs.existsSync(templatePath)) {
    return error(res, 'Plantilla de orden de compra no encontrada en templates/plantilla_ordenCompra.xlsx', 503)
  }

  const zip = new PizZip(fs.readFileSync(templatePath))
  let ssXml = zip.file('xl/sharedStrings.xml')!.asText()
  let sheetXml = zip.file('xl/worksheets/sheet1.xml')!.asText()

  // ── Data preparation ──────────────────────────────────────────────────────

  const client = order.clients || {}
  const contacts: any[] = client.client_contacts || []
  const contact = contacts[0] || {}
  const items: any[] = (order.order_items || []).slice(0, 10)

  const up = (s: string) => (s || '').toUpperCase().trim()

  const fmtDate = (iso: string) =>
    new Date(iso + (iso.length === 10 ? 'T12:00:00' : ''))
      .toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })
      .toUpperCase()

  const SEASON_LABELS: Record<string, string> = { OI: 'OTOÑO/INVIERNO', PV: 'PRIMAVERA/VERANO' }
  const seasonLabel = SEASON_LABELS[order.season] ?? up(order.season || 'TEMPORADA')
  const dateStr     = fmtDate(order.created_at)
  const companyName = up(client.company_name)
  const contactName = up(contact.name)
  const contactPos  = up(contact.position)
  const address     = up(client.address)
  const phone       = (contact.phone || '').trim()
  const email       = (contact.email || '').toLowerCase().trim()

  // Additional info: up to 3 lines
  const infoLines = (order.additional_info || '').split('\n').map((l: string) => up(l))
  while (infoLines.length < 3) infoLines.push('')

  // Delivery info strings for the bottom section
  const deliveryStr = order.delivery_days ? `${order.delivery_days} DÍAS HÁBILES` : ''
  const measDateStr = order.measurements_date ? fmtDate(order.measurements_date) : ''

  // ── Replace existing shared strings ───────────────────────────────────────
  //
  // Index → cell(s) → data
  //  19   → F1      → season label
  //  20   → B8      → company name
  //  21   → B9      → contact name
  //  22   → B10     → contact position
  //  23   → B11     → address
  //  27   → G10     → phone
  //  29   → G11     → email
  //  30   → G8      → date
  //  31   → G9      → city (hardcoded)
  //  41   → A25     → additional info line 2
  //  43   → A26     → additional info line 3
  //  44   → A24     → additional info line 1

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

  for (const [idx, val] of staticReplacements) {
    ssXml = replaceSi(ssXml, idx, val)
  }

  // ── Add new shared strings for item rows ──────────────────────────────────

  const newStrings: string[] = []
  for (const item of items) {
    const pieceParts = [item.piece_type || item.uniform_type || '']
    if (item.fabric) pieceParts.push(item.fabric.name)
    newStrings.push(up(pieceParts.filter(Boolean).join(' · ')))

    const modelRef = item.model
      ? `MOD. #${item.model.number} ${item.model.season}${item.model.season_year}`
      : (item.item_notes || '')
    newStrings.push(up(modelRef))
  }

  const { xml: ss2, startIdx } = addSharedStrings(ssXml, newStrings)
  ssXml = ss2

  // ── Build item rows 14-23 ─────────────────────────────────────────────────

  let newItemRows = ''
  for (let i = 0; i < 10; i++) {
    const rowNum = 14 + i
    const item = items[i]
    if (item) {
      const pieceIdx = startIdx + i * 2
      const modelIdx = startIdx + i * 2 + 1
      newItemRows += itemRow(rowNum, item.quantity, pieceIdx, modelIdx, Number(item.price_per_unit), i === 0)
    } else {
      newItemRows += emptyRow(rowNum, i === 0)
    }
  }

  // Replace everything from row 14 up to (not including) row 24
  const startMarker = sheetXml.indexOf('<row r="14"')
  const endMarker   = sheetXml.indexOf('<row r="24"')
  if (startMarker !== -1 && endMarker !== -1) {
    sheetXml = sheetXml.substring(0, startMarker) + newItemRows + sheetXml.substring(endMarker)
  }

  // ── Financial values ──────────────────────────────────────────────────────

  const subtotal = items.reduce((s: number, i: any) => s + i.quantity * Number(i.price_per_unit), 0)
  const applyIva = order.apply_iva !== false
  const iva      = applyIva ? subtotal * 0.16 : 0
  const total    = subtotal + iva
  const anticipo = total * 0.5
  const retIsr   = (total / 1.16) * 0.0125
  const deposito = total - retIsr

  // Add ANTICIPO formula + cached value to I27 (currently empty)
  sheetXml = sheetXml.replace(
    '<c r="I27" s="25"/>',
    `<c r="I27" s="25"><f>+I26*0.5</f><v>${anticipo}</v></c>`,
  )

  // If no IVA, override the IVA formula
  if (!applyIva) {
    sheetXml = sheetXml.replace(
      /<c r="I25"[^>]*>.*?<\/c>/s,
      `<c r="I25" s="23"><f>0</f><v>0</v></c>`,
    )
  }

  // ── Delivery info: inject into the bottom label cells ────────────────────
  // F34 has label "TIEMPO DE ENTREGA:", G34 is the value cell (currently empty)
  // B35 has label "FECHA TOMA DE MEDIDAS:", C35 is the value cell
  // We'll add these as inline strings if they exist
  if (deliveryStr) {
    // Add as shared string
    const { xml: ss3, startIdx: di } = addSharedStrings(ssXml, [deliveryStr])
    ssXml = ss3
    sheetXml = sheetXml.replace(
      /(<row r="34"[^>]*>)([\s\S]*?)(<\/row>)/,
      (m, open, inner, close) => {
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
  const safeName = (client.company_name || 'cliente').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20)
  const filename = `OrdenCompra-${safeName}-${new Date().toISOString().slice(0, 10)}.xlsx`

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition')
  return res.status(200).send(buffer)
}
