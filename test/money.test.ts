import { describe, expect, it } from 'vitest'

import { formatAmount, splitTax, sum, toMinorUnits } from '../src/money.js'

describe('toMinorUnits', () => {
  it('passes an integer through', () => {
    expect(toMinorUnits(6000)).toBe(6000)
  })

  it('reads an integer written as a string', () => {
    expect(toMinorUnits('6000')).toBe(6000)
  })

  it('refuses a fraction rather than rounding it', () => {
    expect(toMinorUnits(60.5)).toBeNull()
  })

  it('refuses a decimal string', () => {
    expect(toMinorUnits('60.00')).toBeNull()
  })

  it('refuses NaN, Infinity, null and objects', () => {
    expect(toMinorUnits(Number.NaN)).toBeNull()
    expect(toMinorUnits(Number.POSITIVE_INFINITY)).toBeNull()
    expect(toMinorUnits(null)).toBeNull()
    expect(toMinorUnits({})).toBeNull()
  })

  it('accepts zero and negatives', () => {
    expect(toMinorUnits(0)).toBe(0)
    expect(toMinorUnits(-250)).toBe(-250)
  })
})

describe('sum', () => {
  it('is zero for no values', () => {
    expect(sum([])).toBe(0)
  })

  it('keeps a thousand one cent amounts exact', () => {
    expect(sum(Array.from({ length: 1000 }, () => 1))).toBe(1000)
  })
})

describe('splitTax', () => {
  it('reports the whole amount as net at a rate of zero', () => {
    expect(splitTax(6000, 0)).toEqual({ net: 6000, tax: 0 })
  })

  it('reports the whole amount as net at a negative rate', () => {
    expect(splitTax(6000, -24)).toEqual({ net: 6000, tax: 0 })
  })

  it('splits a gross amount at 24 per cent', () => {
    expect(splitTax(6000, 24)).toEqual({ net: 4839, tax: 1161 })
  })

  it('splits a gross amount at 19 per cent', () => {
    expect(splitTax(11900, 19)).toEqual({ net: 10000, tax: 1900 })
  })

  it('keeps net plus tax equal to the amount charged, at every value', () => {
    for (let gross = 0; gross <= 2000; gross += 1) {
      const { net, tax } = splitTax(gross, 24)

      expect(net + tax).toBe(gross)
    }
  })

  it('keeps net plus tax equal to the amount charged, at every rate', () => {
    for (const rate of [5, 6, 9, 10, 13, 17, 19, 20, 21, 22, 23, 24, 25, 27]) {
      const { net, tax } = splitTax(9999, rate)

      expect(net + tax).toBe(9999)
    }
  })

  it('never returns a fractional part', () => {
    const { net, tax } = splitTax(1234567, 17.5)

    expect(Number.isInteger(net)).toBe(true)
    expect(Number.isInteger(tax)).toBe(true)
  })

  it('rounds the tax half up', () => {
    expect(splitTax(100, 100)).toEqual({ net: 50, tax: 50 })
  })
})

describe('formatAmount', () => {
  it('places the decimal point', () => {
    expect(formatAmount(6000, 2)).toBe('60.00')
  })

  it('pads a value smaller than one unit', () => {
    expect(formatAmount(5, 2)).toBe('0.05')
  })

  it('formats zero', () => {
    expect(formatAmount(0, 2)).toBe('0.00')
  })

  it('keeps the sign in front', () => {
    expect(formatAmount(-1250, 2)).toBe('-12.50')
  })

  it('prints the whole number when a currency has no minor unit', () => {
    expect(formatAmount(1250, 0)).toBe('1250')
  })

  it('handles three decimal places', () => {
    expect(formatAmount(1250, 3)).toBe('1.250')
  })
})
