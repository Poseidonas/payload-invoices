import { describe, expect, it } from 'vitest'

import { contentStream, encodePdf, escapeString, winAnsi } from '../src/pdf.js'

const text = (bytes: Uint8Array): string => Buffer.from(bytes).toString('latin1')

const simple = () =>
  encodePdf({
    pages: [{ rules: [{ from: 48, to: 547, y: 700 }], texts: [{ text: 'Hello', x: 48, y: 720 }] }],
    title: 'INV-2026-00001',
  })

describe('winAnsi', () => {
  it('leaves plain ASCII alone', () => {
    expect(winAnsi('Invoice 2026')).toBe('Invoice 2026')
  })

  it('keeps a Latin-1 accent', () => {
    expect(winAnsi('Mañana')).toBe('Mañana')
  })

  it('maps the euro sign onto its WinAnsi code', () => {
    expect(winAnsi('€')).toBe('')
  })

  it('maps a typographic dash and curly quotes', () => {
    expect(winAnsi('—‘’')).toBe('')
  })

  it('replaces a character with no place in the code page', () => {
    expect(winAnsi('Αθήνα')).toBe('?????')
  })

  it('turns a newline into a space, so it cannot break the stream', () => {
    expect(winAnsi('a\nb\r\tc')).toBe('a b  c')
  })

  it('leaves an empty string empty', () => {
    expect(winAnsi('')).toBe('')
  })
})

describe('escapeString', () => {
  it('escapes both parentheses', () => {
    expect(escapeString('a (b) c')).toBe('a \\(b\\) c')
  })

  it('escapes a backslash', () => {
    expect(escapeString('a \\ b')).toBe('a \\\\ b')
  })

  it('escapes nothing in ordinary text', () => {
    expect(escapeString('Widget, large')).toBe('Widget, large')
  })
})

describe('contentStream', () => {
  it('writes one text showing operator per line of text', () => {
    const stream = contentStream({
      texts: [
        { text: 'a', x: 1, y: 2 },
        { text: 'b', x: 1, y: 3 },
      ],
    })

    expect(stream.match(/Tj/g)).toHaveLength(2)
  })

  it('skips empty text rather than writing an empty operator', () => {
    expect(contentStream({ texts: [{ text: '', x: 1, y: 2 }] })).toBe('\n')
  })

  it('selects the bold font when asked', () => {
    expect(contentStream({ texts: [{ font: 'Helvetica-Bold', text: 'a', x: 1, y: 2 }] })).toContain(
      '/F2',
    )
  })

  it('selects the regular font by default', () => {
    expect(contentStream({ texts: [{ text: 'a', x: 1, y: 2 }] })).toContain('/F1')
  })

  it('writes a rule as a stroked line', () => {
    expect(contentStream({ rules: [{ from: 1, to: 2, y: 3 }], texts: [] })).toContain(
      '1 3 m 2 3 l S',
    )
  })
})

describe('encodePdf', () => {
  const bytes = simple()
  const body = text(bytes)

  it('starts with a PDF 1.4 header', () => {
    expect(body.startsWith('%PDF-1.4\n')).toBe(true)
  })

  it('marks the file as binary on the second line', () => {
    expect(body.slice(9, 15)).toBe('%âãÏÓ\n')
  })

  it('ends with the end of file marker', () => {
    expect(body.endsWith('%%EOF\n')).toBe(true)
  })

  it('carries a cross reference table', () => {
    expect(body).toContain('\nxref\n')
  })

  it('carries a trailer naming the catalogue', () => {
    expect(body).toContain('/Root 1 0 R')
  })

  it('names the size of the cross reference table in the trailer', () => {
    const size = Number(/\/Size (\d+)/.exec(body)?.[1])
    const objects = body.match(/\n\d+ 0 obj\n/g) ?? []

    expect(size).toBe(objects.length + 1)
  })

  it('points startxref at the cross reference table', () => {
    const offset = Number(/startxref\n(\d+)\n/.exec(body)?.[1])

    expect(body.slice(offset, offset + 4)).toBe('xref')
  })

  it('points every cross reference entry at its object', () => {
    const offset = Number(/startxref\n(\d+)\n/.exec(body)?.[1])
    const lines = body.slice(offset).split('\n')
    const count = Number(lines[1]?.split(' ')[1])

    for (let index = 1; index < count; index += 1) {
      const entry = lines[2 + index] ?? ''
      const at = Number(entry.slice(0, 10))

      expect(body.slice(at, at + String(index).length + 6)).toBe(`${index} 0 obj`)
    }
  })

  it('writes every cross reference entry as exactly twenty bytes', () => {
    const offset = Number(/startxref\n(\d+)\n/.exec(body)?.[1])
    const table = body.slice(offset)
    const start = table.indexOf('\n', table.indexOf('\n') + 1) + 1
    const count = Number(table.split('\n')[1]?.split(' ')[1])
    const entries = table.slice(start, start + count * 20)

    expect(entries).toHaveLength(count * 20)
    expect(entries.slice(0, 20)).toBe('0000000000 65535 f \n')
  })

  it('declares the stream length in bytes', () => {
    const length = Number(/\/Length (\d+) >>/.exec(body)?.[1])
    const stream = body.slice(body.indexOf('stream\n') + 7, body.indexOf('endstream'))

    expect(Buffer.byteLength(stream, 'latin1')).toBe(length)
  })

  it('declares WinAnsi encoding on both fonts', () => {
    expect(body.match(/WinAnsiEncoding/g)).toHaveLength(2)
  })

  it('puts the title in the document information', () => {
    expect(body).toContain('/Title (INV-2026-00001)')
  })

  it('writes an A4 page by default', () => {
    expect(body).toContain('/MediaBox [0 0 595 842]')
  })

  it('accepts a page size of its own', () => {
    expect(text(encodePdf({ height: 792, pages: [{ texts: [] }], width: 612 }))).toContain(
      '/MediaBox [0 0 612 792]',
    )
  })

  it('counts its pages', () => {
    expect(text(encodePdf({ pages: [{ texts: [] }, { texts: [] }] }))).toContain('/Count 2')
  })

  it('writes one page even when given none', () => {
    expect(text(encodePdf({ pages: [] }))).toContain('/Count 1')
  })

  it('escapes a title that carries a parenthesis', () => {
    expect(text(encodePdf({ pages: [], title: 'a (b)' }))).toContain('/Title (a \\(b\\))')
  })

  it('produces the same bytes for the same document, every time', () => {
    expect(text(simple())).toBe(text(simple()))
  })
})
