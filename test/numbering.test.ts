import { describe, expect, it } from 'vitest'

import { resolveConfig } from '../src/config.js'
import { counterKey, formatNumber, numberFor, yearFor } from '../src/numbering.js'

describe('formatNumber', () => {
  it('pads the sequence to the given width', () => {
    expect(formatNumber({ sequence: 1, series: 'INV', year: 2026 }, 5)).toBe('INV-2026-00001')
  })

  it('does not truncate a sequence wider than the padding', () => {
    expect(formatNumber({ sequence: 123456, series: 'INV', year: 2026 }, 5)).toBe('INV-2026-123456')
  })

  it('pads nothing at a width of zero', () => {
    expect(formatNumber({ sequence: 7, series: 'INV', year: 2026 }, 0)).toBe('INV-2026-7')
  })

  it('keeps the series it is given', () => {
    expect(formatNumber({ sequence: 1, series: 'CN', year: 2026 }, 4)).toBe('CN-2026-0001')
  })

  it('never repeats a number for two sequences of one series and year', () => {
    const seen = new Set<string>()

    for (let sequence = 1; sequence <= 500; sequence += 1) {
      seen.add(formatNumber({ sequence, series: 'INV', year: 2026 }, 5))
    }

    expect(seen.size).toBe(500)
  })

  it('never collides across two years of one series', () => {
    const first = formatNumber({ sequence: 1, series: 'INV', year: 2026 }, 5)
    const second = formatNumber({ sequence: 1, series: 'INV', year: 2027 }, 5)

    expect(first).not.toBe(second)
  })

  it('never collides across two series of one year', () => {
    const first = formatNumber({ sequence: 1, series: 'INV', year: 2026 }, 5)
    const second = formatNumber({ sequence: 1, series: 'CN', year: 2026 }, 5)

    expect(first).not.toBe(second)
  })
})

describe('counterKey', () => {
  it('is one value per series and year', () => {
    expect(counterKey('INV', 2026)).toBe('INV:2026')
  })

  it('differs between series', () => {
    expect(counterKey('INV', 2026)).not.toBe(counterKey('CN', 2026))
  })

  it('differs between years', () => {
    expect(counterKey('INV', 2026)).not.toBe(counterKey('INV', 2027))
  })
})

describe('yearFor', () => {
  const at = new Date('2026-08-19T22:30:00.000Z')

  it('reads the UTC year when the sequence resets yearly', () => {
    expect(yearFor(at, resolveConfig())).toBe(2026)
  })

  it('is zero when the sequence never resets, so one counter serves forever', () => {
    expect(yearFor(at, resolveConfig({ resetYearly: false }))).toBe(0)
  })

  it('uses UTC, not the local clock, so a New Year deployment cannot double a year', () => {
    expect(yearFor(new Date('2027-01-01T00:30:00.000Z'), resolveConfig())).toBe(2027)
  })
})

describe('numberFor', () => {
  it('uses the padding from the options', () => {
    expect(numberFor({ sequence: 3, series: 'INV', year: 2026 }, resolveConfig({ padding: 3 }))).toBe(
      'INV-2026-003',
    )
  })

  it('uses a format given in the options', () => {
    const config = resolveConfig({
      numberFormat: ({ sequence, series, year }) => `${year}/${series}/${sequence}`,
    })

    expect(numberFor({ sequence: 9, series: 'INV', year: 2026 }, config)).toBe('2026/INV/9')
  })
})
