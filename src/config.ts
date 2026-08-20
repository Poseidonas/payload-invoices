import type { Access } from 'payload'

import { defaultDecimals, formatNumber } from './numbering.js'
import type { InvoiceParty, InvoicesConfig, NumberParts, ResolvedConfig } from './types.js'

const refuse: Access = () => false

const signedIn: Access = ({ req }) => Boolean(req.user)

const text = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.length > 0 ? value : fallback

const flag = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback

const positiveInteger = (value: unknown, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }

  const rounded = Math.trunc(value)

  return rounded > 0 ? rounded : fallback
}

const nonNegativeInteger = (value: unknown, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }

  const rounded = Math.trunc(value)

  return rounded >= 0 ? rounded : fallback
}

const nonNegativeNumber = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback

const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : []

export const partyFields = [
  'addressLine1',
  'addressLine2',
  'city',
  'country',
  'email',
  'name',
  'phone',
  'postalCode',
  'registration',
  'state',
  'taxNumber',
  'vatNumber',
] as const

export const toParty = (value: unknown): InvoiceParty => {
  if (!value || typeof value !== 'object') {
    return {}
  }

  const source = value as Record<string, unknown>
  const party: Record<string, string> = {}

  for (const field of partyFields) {
    const entry = source[field]

    if (typeof entry === 'string' && entry.length > 0) {
      party[field] = entry
    }
  }

  return party as InvoiceParty
}

const decimalMap = (value: unknown): Record<string, number> => {
  if (!value || typeof value !== 'object') {
    return defaultDecimals
  }

  const map: Record<string, number> = { ...defaultDecimals }

  for (const [code, digits] of Object.entries(value as Record<string, unknown>)) {
    if (typeof digits === 'number' && Number.isInteger(digits) && digits >= 0 && digits <= 8) {
      map[code.toUpperCase()] = digits
    }
  }

  return map
}

export const resolveConfig = (incoming: InvoicesConfig = {}): ResolvedConfig => {
  const padding = nonNegativeInteger(incoming.padding, 5)
  const format =
    typeof incoming.numberFormat === 'function'
      ? incoming.numberFormat
      : (parts: NumberParts) => formatNumber(parts, padding)

  return {
    adjustmentLabel: text(incoming.adjustmentLabel, 'Adjustment'),
    attempts: positiveInteger(incoming.attempts, 20),
    autoIssueOnStatus: strings(incoming.autoIssueOnStatus),
    buyerAddressSource: incoming.buyerAddressSource === 'shipping' ? 'shipping' : 'billing',
    buyerVatFieldName: text(incoming.buyerVatFieldName, 'vatNumber'),
    countersSlug: text(incoming.countersSlug, 'invoice-counters'),
    createAccess: typeof incoming.createAccess === 'function' ? incoming.createAccess : refuse,
    creditNoteSeries: text(incoming.creditNoteSeries, 'CN'),
    customersSlug: text(incoming.customersSlug, 'users'),
    decimals: decimalMap(incoming.decimals),
    defaultDecimals: nonNegativeInteger(incoming.defaultDecimals, 2),
    disabled: incoming.disabled === true,
    footer: typeof incoming.footer === 'string' ? incoming.footer : '',
    invoicesSlug: text(incoming.invoicesSlug, 'invoices'),
    numberFormat: format,
    onLineMismatch: incoming.onLineMismatch === 'refuse' ? 'refuse' : 'adjust',
    ordersSlug: text(incoming.ordersSlug, 'orders'),
    padding,
    productsSlug: text(incoming.productsSlug, 'products'),
    readAccess: typeof incoming.readAccess === 'function' ? incoming.readAccess : signedIn,
    refundsSlug: typeof incoming.refundsSlug === 'string' ? incoming.refundsSlug : '',
    renderer: typeof incoming.renderer === 'function' ? incoming.renderer : null,
    resetYearly: flag(incoming.resetYearly, true),
    resolveLines: typeof incoming.resolveLines === 'function' ? incoming.resolveLines : null,
    seller: toParty(incoming.seller),
    series: text(incoming.series, 'INV'),
    startAt: positiveInteger(incoming.startAt, 1),
    taxRate: nonNegativeNumber(incoming.taxRate, 0),
    transactionsSlug: text(incoming.transactionsSlug, 'transactions'),
    variantsSlug: text(incoming.variantsSlug, 'variants'),
  }
}
