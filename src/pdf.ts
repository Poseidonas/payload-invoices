export type PdfFont = 'Helvetica' | 'Helvetica-Bold'

export type PdfText = {
  font?: PdfFont
  size?: number
  text: string
  x: number
  y: number
}

export type PdfRule = {
  from: number
  to: number
  width?: number
  y: number
}

export type PdfPage = {
  rules?: PdfRule[]
  texts: PdfText[]
}

export type PdfDocument = {
  height?: number
  pages: PdfPage[]
  title?: string
  width?: number
}

const winAnsiSpecials: Record<number, number> = {
  0x0152: 0x8c,
  0x0153: 0x9c,
  0x0160: 0x8a,
  0x0161: 0x9a,
  0x0178: 0x9f,
  0x017d: 0x8e,
  0x017e: 0x9e,
  0x0192: 0x83,
  0x02c6: 0x88,
  0x02dc: 0x98,
  0x2013: 0x96,
  0x2014: 0x97,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201a: 0x82,
  0x201c: 0x93,
  0x201d: 0x94,
  0x201e: 0x84,
  0x2020: 0x86,
  0x2021: 0x87,
  0x2022: 0x95,
  0x2026: 0x85,
  0x2030: 0x89,
  0x2039: 0x8b,
  0x203a: 0x9b,
  0x20ac: 0x80,
  0x2122: 0x99,
}

/**
 * Maps text onto the WinAnsi code page the base fourteen fonts are declared
 * with. A character with no place there becomes a question mark, which is
 * visible rather than silently missing.
 */
export const winAnsi = (text: string): string => {
  let out = ''

  for (const character of text) {
    const code = character.codePointAt(0) ?? 0x3f

    if (code === 0x0a || code === 0x0d || code === 0x09) {
      out += ' '
      continue
    }

    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) {
      out += String.fromCharCode(code)
      continue
    }

    const mapped = winAnsiSpecials[code]

    out += mapped === undefined ? '?' : String.fromCharCode(mapped)
  }

  return out
}

export const escapeString = (text: string): string =>
  winAnsi(text).replace(/[\\()]/g, (character) => `\\${character}`)

const number = (value: number): string => {
  if (!Number.isFinite(value)) {
    return '0'
  }

  const rounded = Math.round(value * 100) / 100

  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, '')
}

const fontName = (font: PdfFont | undefined): string => (font === 'Helvetica-Bold' ? '/F2' : '/F1')

export const contentStream = (page: PdfPage): string => {
  const parts: string[] = []

  for (const rule of page.rules ?? []) {
    parts.push(
      `${number(rule.width ?? 0.5)} w`,
      `${number(rule.from)} ${number(rule.y)} m ${number(rule.to)} ${number(rule.y)} l S`,
    )
  }

  for (const text of page.texts) {
    if (text.text.length === 0) {
      continue
    }

    parts.push(
      'BT',
      `${fontName(text.font)} ${number(text.size ?? 10)} Tf`,
      `${number(text.x)} ${number(text.y)} Td`,
      `(${escapeString(text.text)}) Tj`,
      'ET',
    )
  }

  return `${parts.join('\n')}\n`
}

const pad10 = (value: number): string => String(value).padStart(10, '0')

/**
 * Writes a PDF 1.4 file with uncompressed content streams and the base
 * fourteen fonts. No dependency, no embedded font, no image.
 */
export const encodePdf = (doc: PdfDocument): Uint8Array => {
  const width = doc.width ?? 595
  const height = doc.height ?? 842
  const pages = doc.pages.length > 0 ? doc.pages : [{ texts: [] }]
  const bodies: string[] = []
  const first = 6
  const pageIds = pages.map((_, index) => first + index * 2)

  bodies.push(`<< /Type /Catalog /Pages 2 0 R >>`)
  bodies.push(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  )
  bodies.push(
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`,
  )
  bodies.push(
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`,
  )
  bodies.push(`<< /Title (${escapeString(doc.title ?? 'Invoice')}) /Producer (payload-invoices) >>`)

  pages.forEach((page, index) => {
    const id = pageIds[index] as number
    const content = contentStream(page)

    bodies.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${number(width)} ${number(height)}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${id + 1} 0 R >>`,
    )
    bodies.push(
      `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}endstream`,
    )
  })

  const chunks: Buffer[] = []
  const offsets: number[] = []
  let position = 0

  const push = (value: string): void => {
    const buffer = Buffer.from(value, 'latin1')

    chunks.push(buffer)
    position += buffer.length
  }

  push('%PDF-1.4\n')
  push('%\u00e2\u00e3\u00cf\u00d3\n')

  bodies.forEach((body, index) => {
    offsets.push(position)
    push(`${index + 1} 0 obj\n${body}\nendobj\n`)
  })

  const startxref = position
  const size = bodies.length + 1

  push(`xref\n0 ${size}\n`)
  push('0000000000 65535 f \n')

  for (const offset of offsets) {
    push(`${pad10(offset)} 00000 n \n`)
  }

  push(`trailer\n<< /Size ${size} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${startxref}\n%%EOF\n`)

  return new Uint8Array(Buffer.concat(chunks))
}
