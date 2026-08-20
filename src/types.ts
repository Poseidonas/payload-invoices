import type { Access, Payload, PayloadRequest } from 'payload'

/**
 * A party on an invoice. Every field is frozen into the document when the
 * invoice is issued and is never read again afterwards.
 */
export type InvoiceParty = {
  addressLine1?: string
  addressLine2?: string
  city?: string
  country?: string
  email?: string
  name?: string
  phone?: string
  postalCode?: string
  registration?: string
  state?: string
  taxNumber?: string
  vatNumber?: string
}

/**
 * One line of an invoice. Every amount is a whole number of minor units.
 */
export type InvoiceLine = {
  description: string
  lineTotal: number
  product?: string
  quantity: number
  sku?: string
  unitPrice: number
  variant?: string
}

export type InvoiceKind = 'credit-note' | 'invoice'

/**
 * The parts a number is built from. `sequence` is gapless within its series
 * and year.
 */
export type NumberParts = {
  sequence: number
  series: string
  year: number
}

export type ResolveLines = (args: {
  currency: string
  order: Record<string, unknown>
  payload: Payload
  req: PayloadRequest
}) => InvoiceLine[] | Promise<InvoiceLine[]>

export type InvoiceRenderer = (args: {
  decimals: number
  invoice: Record<string, unknown>
}) => Promise<Uint8Array> | Uint8Array

export type InvoicesConfig = {
  /**
   * Label of the line added when the lines do not add up to the amount
   * charged. Defaults to 'Adjustment'.
   */
  adjustmentLabel?: string
  /**
   * Order statuses that issue an invoice automatically when an order enters
   * them. Defaults to an empty list, which issues nothing automatically.
   */
  autoIssueOnStatus?: string[]
  /**
   * Where the buyer address is taken from. 'billing' reads the transaction's
   * billing address and falls back to the order's shipping address;
   * 'shipping' reads the shipping address only. Defaults to 'billing'.
   */
  buyerAddressSource?: 'billing' | 'shipping'
  /**
   * Field on the customer document holding their VAT number.
   * Defaults to 'vatNumber'.
   */
  buyerVatFieldName?: string
  /**
   * Slug of the collection the customers live in. Defaults to 'users'.
   */
  customersSlug?: string
  /**
   * Slug of the collection holding the sequence counters.
   * Defaults to 'invoice-counters'.
   */
  countersSlug?: string
  /**
   * Series used for credit notes. Defaults to 'CN'. Setting it to the same
   * value as `series` puts credit notes in the invoice sequence.
   */
  creditNoteSeries?: string
  /**
   * Who may create an invoice through the API. Defaults to refusing everyone,
   * because an invoice is issued by `issueInvoice`, not written by hand.
   */
  createAccess?: Access
  /**
   * Minor unit digits per currency code. Defaults to two for EUR, USD and GBP.
   */
  decimals?: Record<string, number>
  /**
   * Digits used when a currency is not listed in `decimals`. Defaults to 2.
   */
  defaultDecimals?: number
  /**
   * Stops the automatic issuing hook while leaving every field and collection
   * in place, so an existing database keeps its shape. Defaults to false.
   */
  disabled?: boolean
  /**
   * Text printed at the bottom of every document.
   */
  footer?: string
  /**
   * Slug of the invoices collection. Defaults to 'invoices'.
   */
  invoicesSlug?: string
  /**
   * Builds the printed number from its parts. Defaults to
   * `SERIES-YEAR-00001`.
   */
  numberFormat?: (parts: NumberParts) => string
  /**
   * What to do when the lines do not add up to the amount charged.
   * 'adjust' adds one labelled line for the difference, 'refuse' throws.
   * Defaults to 'adjust'.
   */
  onLineMismatch?: 'adjust' | 'refuse'
  /**
   * Slug of the orders collection. Defaults to 'orders'.
   */
  ordersSlug?: string
  /**
   * Width of the numeric part, left padded with zeros. Defaults to 5.
   */
  padding?: number
  /**
   * How many times to look for a free sequence value before giving up.
   * Defaults to 20.
   */
  attempts?: number
  /**
   * Slug of the products collection. Defaults to 'products'.
   */
  productsSlug?: string
  /**
   * Who may read invoices. Defaults to any signed in user.
   */
  readAccess?: Access
  /**
   * Slug of a refunds collection, when you have one. Given a value, the
   * `refund` field becomes a relationship to it instead of plain text.
   */
  refundsSlug?: string
  /**
   * Turns the frozen document into PDF bytes. Defaults to the built-in
   * renderer described in the README.
   */
  renderer?: InvoiceRenderer
  /**
   * Builds the lines of an invoice from the order. The default reads the
   * price of each product or variant in the order's currency.
   */
  resolveLines?: ResolveLines
  /**
   * Starts a new sequence each calendar year. Defaults to true.
   */
  resetYearly?: boolean
  /**
   * Your own details, printed on every document. `name` is required for an
   * invoice to be issued.
   */
  seller?: InvoiceParty
  /**
   * Series used for invoices. Defaults to 'INV'.
   */
  series?: string
  /**
   * Value given to the first document of a series. Defaults to 1.
   */
  startAt?: number
  /**
   * Tax rate as a percentage of the net, used to split the amount charged
   * into net and tax. Defaults to 0, which reports the whole amount as net.
   */
  taxRate?: number
  /**
   * Slug of the transactions collection, read for the billing address.
   * Defaults to 'transactions'.
   */
  transactionsSlug?: string
  /**
   * Slug of the variants collection. Defaults to 'variants'.
   */
  variantsSlug?: string
}

export type ResolvedConfig = {
  adjustmentLabel: string
  attempts: number
  autoIssueOnStatus: string[]
  buyerAddressSource: 'billing' | 'shipping'
  buyerVatFieldName: string
  countersSlug: string
  createAccess: Access
  creditNoteSeries: string
  customersSlug: string
  decimals: Record<string, number>
  defaultDecimals: number
  disabled: boolean
  footer: string
  invoicesSlug: string
  numberFormat: (parts: NumberParts) => string
  onLineMismatch: 'adjust' | 'refuse'
  ordersSlug: string
  padding: number
  productsSlug: string
  readAccess: Access
  refundsSlug: string
  renderer: null | InvoiceRenderer
  resetYearly: boolean
  resolveLines: null | ResolveLines
  seller: InvoiceParty
  series: string
  startAt: number
  taxRate: number
  transactionsSlug: string
  variantsSlug: string
}
