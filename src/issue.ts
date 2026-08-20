import type { Payload, PayloadRequest, Where } from 'payload'

import { resolveConfig, toParty } from './config.js'
import { claimSequence, releaseSequence } from './counters.js'
import { InvoiceError, refusalCodes } from './errors.js'
import { splitTax, sum, toMinorUnits } from './money.js'
import { numberFor, yearFor } from './numbering.js'
import { buyerFor, defaultResolveLines, relationId } from './snapshot.js'
import type { InvoiceLine, InvoiceParty, InvoicesConfig, ResolvedConfig } from './types.js'

type Row = Record<string, unknown>

export const decimalsFor = (currency: string, config: ResolvedConfig): number =>
  config.decimals[currency.toUpperCase()] ?? config.defaultDecimals

const cleanLines = (lines: InvoiceLine[]): InvoiceLine[] =>
  lines.map((line) => ({
    ...line,
    lineTotal: toMinorUnits(line.lineTotal) ?? 0,
    quantity: toMinorUnits(line.quantity) ?? 0,
    unitPrice: toMinorUnits(line.unitPrice) ?? 0,
  }))

/**
 * Makes the lines add up to the amount that was charged, without changing any
 * line. The difference becomes one labelled line of its own.
 */
export const reconcile = (
  lines: InvoiceLine[],
  total: number,
  config: ResolvedConfig,
): InvoiceLine[] => {
  const linesTotal = sum(lines.map((line) => line.lineTotal))

  if (linesTotal === total) {
    return lines
  }

  if (config.onLineMismatch === 'refuse') {
    throw new InvoiceError(
      refusalCodes.TotalMismatch,
      `The lines add up to ${linesTotal} but ${total} was charged.`,
      { linesTotal, total },
    )
  }

  return [
    ...lines,
    {
      description: config.adjustmentLabel,
      lineTotal: total - linesTotal,
      quantity: 1,
      unitPrice: total - linesTotal,
    },
  ]
}

const existing = async (
  payload: Payload,
  where: Where,
  config: ResolvedConfig,
  req: PayloadRequest,
): Promise<Row[]> => {
  const result = await payload.find({
    collection: config.invoicesSlug,
    depth: 0,
    overrideAccess: true,
    pagination: false,
    req,
    where,
  })

  return result.docs as Row[]
}

const write = async (
  payload: Payload,
  data: Row,
  parts: { sequence: number; series: string; year: number },
  config: ResolvedConfig,
  req: PayloadRequest,
): Promise<Row> => {
  try {
    return (await payload.create({
      collection: config.invoicesSlug,
      data,
      depth: 0,
      overrideAccess: true,
      req,
    })) as Row
  } catch (error) {
    await releaseSequence(payload, parts, config, req)

    throw error
  }
}

export type IssueInvoiceArgs = {
  /**
   * Issues a second invoice for an order that already has one. Off by default.
   */
  allowDuplicate?: boolean
  buyer?: InvoiceParty
  config?: InvoicesConfig
  dueAt?: Date | string
  issuedAt?: Date | string
  lines?: InvoiceLine[]
  notes?: string
  order: number | string
  req: PayloadRequest
  seller?: InvoiceParty
  taxRate?: number
}

/**
 * Issues an invoice for an order, freezing the seller, the buyer, the lines
 * and every amount into a document that later changes never touch.
 */
export const issueInvoice = async (payload: Payload, args: IssueInvoiceArgs): Promise<Row> => {
  const config = resolveConfig(args.config)
  const seller = { ...config.seller, ...toParty(args.seller) }

  if (!seller.name) {
    throw new InvoiceError(
      refusalCodes.NoSeller,
      'An invoice needs a seller name. Pass `seller` to the plugin or to issueInvoice.',
    )
  }

  const order = (await payload.findByID({
    id: args.order,
    collection: config.ordersSlug,
    depth: 0,
    disableErrors: true,
    overrideAccess: true,
    req: args.req,
  })) as null | Row

  if (!order) {
    throw new InvoiceError(refusalCodes.OrderNotFound, `Order ${args.order} does not exist.`, {
      order: args.order,
    })
  }

  if (args.allowDuplicate !== true) {
    const already = await existing(
      payload,
      { and: [{ kind: { equals: 'invoice' } }, { order: { equals: args.order } }] },
      config,
      args.req,
    )

    if (already.length > 0) {
      throw new InvoiceError(
        refusalCodes.AlreadyIssued,
        `Order ${args.order} already carries invoice ${String(already[0]?.number ?? '')}.`,
        { invoice: already[0]?.id, order: args.order },
      )
    }
  }

  const total = toMinorUnits(order.amount)

  if (total === null || total < 0) {
    throw new InvoiceError(
      refusalCodes.InvalidAmount,
      'The order amount is not a whole number of minor units.',
      { amount: order.amount },
    )
  }

  const currency = typeof order.currency === 'string' ? order.currency.toUpperCase() : ''
  const resolver = config.resolveLines ?? defaultResolveLines(config)
  const resolved = Array.isArray(args.lines)
    ? cleanLines(args.lines)
    : cleanLines(await resolver({ currency, order, payload, req: args.req }))
  const lines = reconcile(resolved, total, config)
  const taxRate = typeof args.taxRate === 'number' && args.taxRate >= 0 ? args.taxRate : config.taxRate
  const { net, tax } = splitTax(total, taxRate)
  const issuedAt = args.issuedAt ? new Date(args.issuedAt) : new Date()
  const year = yearFor(issuedAt, config)
  const sequence = await claimSequence(payload, { series: config.series, year }, config, args.req)
  const parts = { sequence, series: config.series, year }

  return write(
    payload,
    {
      buyer: { ...(await buyerFor(payload, { config, order, req: args.req })), ...toParty(args.buyer) },
      currency,
      decimals: decimalsFor(currency, config),
      dueAt: args.dueAt ? new Date(args.dueAt).toISOString() : null,
      footer: config.footer,
      issuedAt: issuedAt.toISOString(),
      kind: 'invoice',
      lines,
      net,
      notes: typeof args.notes === 'string' ? args.notes : '',
      number: numberFor(parts, config),
      order: args.order,
      orderReference: String(args.order),
      seller,
      sequence,
      series: config.series,
      tax,
      taxRate,
      total,
      year,
    },
    parts,
    config,
    args.req,
  )
}

export type IssueCreditNoteArgs = {
  amount?: number
  config?: InvoicesConfig
  invoice: number | string
  issuedAt?: Date | string
  lines?: InvoiceLine[]
  notes?: string
  refund?: number | string
  req: PayloadRequest
}

/**
 * Issues a credit note against an issued invoice, never for more than the
 * part of it that has not been credited already.
 */
export const issueCreditNote = async (
  payload: Payload,
  args: IssueCreditNoteArgs,
): Promise<Row> => {
  const config = resolveConfig(args.config)
  const original = (await payload.findByID({
    id: args.invoice,
    collection: config.invoicesSlug,
    depth: 0,
    disableErrors: true,
    overrideAccess: true,
    req: args.req,
  })) as null | Row

  if (!original || original.kind === 'credit-note') {
    throw new InvoiceError(
      refusalCodes.InvoiceNotFound,
      `Invoice ${args.invoice} does not exist.`,
      { invoice: args.invoice },
    )
  }

  const invoiceTotal = toMinorUnits(original.total) ?? 0
  const credited = sum(
    (
      await existing(payload, { creditedInvoice: { equals: args.invoice } }, config, args.req)
    ).map((doc) => toMinorUnits(doc.total) ?? 0),
  )
  const remaining = Math.max(0, invoiceTotal - credited)
  const requested = args.amount === undefined ? remaining : toMinorUnits(args.amount)

  if (requested === null || requested <= 0) {
    throw new InvoiceError(
      refusalCodes.InvalidAmount,
      'A credit note must be a whole number of minor units above zero.',
      { amount: args.amount },
    )
  }

  if (requested > remaining) {
    throw new InvoiceError(
      refusalCodes.OverCredited,
      `Only ${remaining} of ${invoiceTotal} is still open on this invoice.`,
      { amount: requested, remaining },
    )
  }

  const taxRate = typeof original.taxRate === 'number' ? original.taxRate : 0
  const { net, tax } = splitTax(requested, taxRate)
  const lines = Array.isArray(args.lines)
    ? reconcile(cleanLines(args.lines), requested, config)
    : [
        {
          description: `Credit against ${String(original.number ?? '')}`.trim(),
          lineTotal: requested,
          quantity: 1,
          unitPrice: requested,
        },
      ]
  const issuedAt = args.issuedAt ? new Date(args.issuedAt) : new Date()
  const year = yearFor(issuedAt, config)
  const series = config.creditNoteSeries
  const sequence = await claimSequence(payload, { series, year }, config, args.req)
  const parts = { sequence, series, year }

  return write(
    payload,
    {
      buyer: original.buyer,
      creditedInvoice: args.invoice,
      creditedNumber: original.number,
      currency: original.currency,
      decimals: original.decimals,
      footer: config.footer,
      issuedAt: issuedAt.toISOString(),
      kind: 'credit-note',
      lines,
      net,
      notes: typeof args.notes === 'string' ? args.notes : '',
      number: numberFor(parts, config),
      order: relationId(original.order),
      orderReference: original.orderReference,
      ...(args.refund === undefined ? {} : { refund: args.refund }),
      seller: original.seller,
      sequence,
      series,
      tax,
      taxRate,
      total: requested,
      year,
    },
    parts,
    config,
    args.req,
  )
}
