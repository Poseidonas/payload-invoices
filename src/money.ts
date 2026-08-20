export const toMinorUnits = (value: unknown): null | number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isSafeInteger(value) ? value : null
  }

  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const parsed = Number(value)

    return Number.isSafeInteger(parsed) ? parsed : null
  }

  return null
}

export const sum = (values: number[]): number => {
  let total = 0

  for (const value of values) {
    total += value
  }

  return total
}

/**
 * Splits a gross amount into net and tax at the given rate, in whole minor
 * units. The tax is rounded half up and the net takes the remainder, so
 * `net + tax` is always exactly the amount that was charged.
 */
export const splitTax = (gross: number, ratePerCent: number): { net: number; tax: number } => {
  if (!Number.isFinite(ratePerCent) || ratePerCent <= 0) {
    return { net: gross, tax: 0 }
  }

  const tax = Math.round((gross * ratePerCent) / (100 + ratePerCent))

  return { net: gross - tax, tax }
}

export const formatAmount = (minor: number, decimals: number): string => {
  if (decimals <= 0) {
    return String(minor)
  }

  const negative = minor < 0
  const digits = String(Math.abs(minor)).padStart(decimals + 1, '0')
  const whole = digits.slice(0, digits.length - decimals)
  const fraction = digits.slice(digits.length - decimals)

  return `${negative ? '-' : ''}${whole}.${fraction}`
}
