import { formatAmount } from './money.js'
import { encodePdf } from './pdf.js'
import type { PdfPage, PdfText } from './pdf.js'
import type { InvoiceParty } from './types.js'

type Row = Record<string, unknown>

const widths: Record<string, number> = {
  ' ': 278,
  ',': 278,
  '-': 333,
  '.': 278,
  '0': 556,
  '1': 556,
  '2': 556,
  '3': 556,
  '4': 556,
  '5': 556,
  '6': 556,
  '7': 556,
  '8': 556,
  '9': 556,
}

export const numericWidth = (text: string, size: number): number => {
  let total = 0

  for (const character of text) {
    total += widths[character] ?? 556
  }

  return (total * size) / 1000
}

export const truncate = (text: string, size: number, room: number): string => {
  const fits = Math.max(1, Math.floor(room / (size * 0.5)))

  return text.length <= fits ? text : `${text.slice(0, Math.max(1, fits - 1))}.`
}

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const partyLines = (value: unknown): string[] => {
  const party = (value ?? {}) as InvoiceParty
  const city = [str(party.postalCode), str(party.city)].filter(Boolean).join(' ')
  const region = [city, str(party.state)].filter(Boolean).join(', ')

  return [
    str(party.name),
    str(party.addressLine1),
    str(party.addressLine2),
    region,
    str(party.country),
    str(party.vatNumber) && `VAT ${str(party.vatNumber)}`,
    str(party.taxNumber) && `Tax number ${str(party.taxNumber)}`,
    str(party.registration) && `Registration ${str(party.registration)}`,
    str(party.email),
    str(party.phone),
  ].filter((line): line is string => Boolean(line))
}

const dateOf = (value: unknown): string => {
  const text = typeof value === 'string' ? value : ''
  const parsed = text.length > 0 ? new Date(text) : null

  return parsed && !Number.isNaN(parsed.getTime()) ? (parsed.toISOString().slice(0, 10)) : ''
}

/**
 * Lays out the frozen document as a single A4 page and returns PDF bytes.
 * Replace it with your own by passing `renderer`.
 */
export const renderInvoice = (args: { decimals: number; invoice: Row }): Uint8Array => {
  const { decimals, invoice } = args
  const left = 48
  const right = 547
  const texts: PdfText[] = []
  const rules: PdfPage['rules'] = []
  const money = (value: unknown): string =>
    formatAmount(typeof value === 'number' ? value : 0, decimals)
  const rightAt = (text: string, size: number): number => right - numericWidth(text, size)

  const heading = invoice.kind === 'credit-note' ? 'CREDIT NOTE' : 'INVOICE'

  texts.push({ font: 'Helvetica-Bold', size: 20, text: heading, x: left, y: 780 })

  const meta: [string, string][] = (
    [
      ['Number', str(invoice.number)],
      ['Issued', dateOf(invoice.issuedAt)],
      ['Due', dateOf(invoice.dueAt)],
      ['Currency', str(invoice.currency)],
      ['Order', str(invoice.orderReference)],
      ['Credit of', str(invoice.creditedNumber)],
    ] as [string, string][]
  ).filter((entry) => entry[1].length > 0)

  let metaY = 784

  for (const [label, value] of meta) {
    texts.push({ size: 9, text: label, x: 380, y: metaY })
    texts.push({ font: 'Helvetica-Bold', size: 9, text: value, x: 450, y: metaY })
    metaY -= 13
  }

  let y = 740

  texts.push({ font: 'Helvetica-Bold', size: 9, text: 'From', x: left, y })
  y -= 13

  for (const line of partyLines(invoice.seller)) {
    texts.push({ size: 9, text: line, x: left, y })
    y -= 12
  }

  y -= 10
  texts.push({ font: 'Helvetica-Bold', size: 9, text: 'Bill to', x: left, y })
  y -= 13

  for (const line of partyLines(invoice.buyer)) {
    texts.push({ size: 9, text: line, x: left, y })
    y -= 12
  }

  y -= 18
  rules.push({ from: left, to: right, y: y + 10 })
  texts.push({ font: 'Helvetica-Bold', size: 9, text: 'Description', x: left, y })
  texts.push({ font: 'Helvetica-Bold', size: 9, text: 'Qty', x: 360, y })
  texts.push({ font: 'Helvetica-Bold', size: 9, text: 'Unit', x: 410, y })
  texts.push({ font: 'Helvetica-Bold', size: 9, text: 'Amount', x: rightAt('Amount', 9), y })
  y -= 6
  rules.push({ from: left, to: right, y })
  y -= 14

  const lines = Array.isArray(invoice.lines) ? invoice.lines : []

  for (const entry of lines) {
    if (y < 140) {
      break
    }

    const line = (entry ?? {}) as Row
    const quantity = String(typeof line.quantity === 'number' ? line.quantity : 0)
    const unit = money(line.unitPrice)
    const total = money(line.lineTotal)

    texts.push({ size: 9, text: truncate(str(line.description), 9, 300), x: left, y })
    texts.push({ size: 9, text: quantity, x: 360, y })
    texts.push({ size: 9, text: unit, x: 410, y })
    texts.push({ size: 9, text: total, x: rightAt(total, 9), y })
    y -= 13
  }

  y -= 4
  rules.push({ from: 360, to: right, y })
  y -= 16

  const totals: [string, string, boolean][] = [
    ['Net', money(invoice.net), false],
    [
      typeof invoice.taxRate === 'number' && invoice.taxRate > 0
        ? `Tax ${invoice.taxRate}%`
        : 'Tax',
      money(invoice.tax),
      false,
    ],
    ['Total', money(invoice.total), true],
  ]

  for (const [label, value, strong] of totals) {
    const size = strong ? 11 : 9

    texts.push({ font: strong ? 'Helvetica-Bold' : 'Helvetica', size, text: label, x: 410, y })
    texts.push({
      font: strong ? 'Helvetica-Bold' : 'Helvetica',
      size,
      text: value,
      x: rightAt(value, size),
      y,
    })
    y -= strong ? 18 : 14
  }

  let footY = 96

  for (const line of [str(invoice.notes), str(invoice.footer)].filter(Boolean)) {
    texts.push({ size: 8, text: truncate(line, 8, right - left), x: left, y: footY })
    footY -= 11
  }

  if (str(invoice.voidedAt).length > 0) {
    texts.push({ font: 'Helvetica-Bold', size: 12, text: 'VOID', x: left, y: 120 })
  }

  return encodePdf({
    pages: [{ rules, texts }],
    title: `${heading} ${str(invoice.number)}`.trim(),
  })
}
