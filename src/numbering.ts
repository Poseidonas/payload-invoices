import type { NumberParts, ResolvedConfig } from './types.js'

export const defaultDecimals: Record<string, number> = {
  EUR: 2,
  GBP: 2,
  USD: 2,
}

export const formatNumber = (parts: NumberParts, padding: number): string => {
  const digits = String(parts.sequence)
  const padded = digits.length >= padding ? digits : digits.padStart(padding, '0')

  return `${parts.series}-${parts.year}-${padded}`
}

export const counterKey = (series: string, year: number): string => `${series}:${year}`

export const yearFor = (at: Date, config: ResolvedConfig): number =>
  config.resetYearly ? at.getUTCFullYear() : 0

export const numberFor = (parts: NumberParts, config: ResolvedConfig): string =>
  config.numberFormat(parts)
