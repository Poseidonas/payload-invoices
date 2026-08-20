import type { Payload, PayloadRequest } from 'payload'

import { toMinorUnits } from './money.js'
import type { InvoiceLine, InvoiceParty, ResolvedConfig } from './types.js'

type Row = Record<string, unknown>

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

export const relationId = (value: unknown): null | number | string => {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value === 'object') {
    const id = (value as { id?: unknown }).id

    return typeof id === 'number' || typeof id === 'string' ? id : null
  }

  return typeof value === 'number' || typeof value === 'string' ? value : null
}

const put = (party: Record<string, string>, field: string, value: string): void => {
  if (value.length > 0) {
    party[field] = value
  }
}

/**
 * Turns one of the plugin's address groups into a party. The name is the
 * company when there is one, and the two personal names otherwise.
 */
export const partyFromAddress = (value: unknown): InvoiceParty => {
  if (!value || typeof value !== 'object') {
    return {}
  }

  const address = value as Row
  const party: Record<string, string> = {}
  const person = [str(address.firstName), str(address.lastName)].filter(Boolean).join(' ')

  put(party, 'name', str(address.company) || person)
  put(party, 'addressLine1', str(address.addressLine1))
  put(party, 'addressLine2', str(address.addressLine2))
  put(party, 'city', str(address.city))
  put(party, 'state', str(address.state))
  put(party, 'postalCode', str(address.postalCode))
  put(party, 'country', str(address.country))
  put(party, 'phone', str(address.phone))

  return party as InvoiceParty
}

const billingAddress = async (
  payload: Payload,
  order: Row,
  config: ResolvedConfig,
  req: PayloadRequest,
): Promise<null | Row> => {
  const transactions = Array.isArray(order.transactions) ? order.transactions : []

  for (const entry of transactions) {
    const id = relationId(entry)

    if (id === null) {
      continue
    }

    const doc = (await payload.findByID({
      id,
      collection: config.transactionsSlug,
      depth: 0,
      disableErrors: true,
      overrideAccess: true,
      req,
    })) as null | Row

    const address = doc?.billingAddress

    if (address && typeof address === 'object') {
      return address as Row
    }
  }

  return null
}

/**
 * Builds the buyer from the order, and from the customer document when the
 * order names one. An order placed by a signed in customer carries no
 * `customerEmail`, so the email is read from the customer instead.
 */
export const buyerFor = async (
  payload: Payload,
  args: { config: ResolvedConfig; order: Row; req: PayloadRequest },
): Promise<InvoiceParty> => {
  const { config, order, req } = args
  const shipping = order.shippingAddress
  const billing =
    config.buyerAddressSource === 'billing' ? await billingAddress(payload, order, config, req) : null
  const party = { ...partyFromAddress(billing ?? shipping) } as Record<string, string>

  put(party, 'email', str(order.customerEmail))

  const customer = relationId(order.customer)

  if (customer !== null) {
    const doc = (await payload.findByID({
      id: customer,
      collection: config.customersSlug,
      depth: 0,
      disableErrors: true,
      overrideAccess: true,
      req,
    })) as null | Row

    if (doc) {
      if (!party.email) {
        put(party, 'email', str(doc.email))
      }

      if (!party.name) {
        put(party, 'name', str(doc.name))
      }

      put(party, 'vatNumber', str(doc[config.buyerVatFieldName]))
    }
  }

  return party as InvoiceParty
}

const priceOf = (doc: Row, currency: string): null | number =>
  toMinorUnits(doc[`priceIn${currency.toUpperCase()}`])

const titleOf = (doc: Row): string =>
  str(doc.title) || str(doc.name) || str(doc.sku) || String(doc.id ?? '')

/**
 * Builds the lines of an invoice by reading the price of each product or
 * variant in the order's currency, at the moment the invoice is issued.
 */
export const defaultResolveLines = (config: ResolvedConfig) =>
  async (args: {
    currency: string
    order: Row
    payload: Payload
    req: PayloadRequest
  }): Promise<InvoiceLine[]> => {
    const { currency, order, payload, req } = args
    const items = Array.isArray(order.items) ? order.items : []
    const lines: InvoiceLine[] = []

    for (const entry of items) {
      if (!entry || typeof entry !== 'object') {
        continue
      }

      const item = entry as Row
      const quantity = toMinorUnits(item.quantity) ?? 0

      if (quantity <= 0) {
        continue
      }

      const variant = relationId(item.variant)
      const product = relationId(item.product)
      const target =
        variant === null
          ? product === null
            ? null
            : { collection: config.productsSlug, id: product }
          : { collection: config.variantsSlug, id: variant }

      if (target === null) {
        continue
      }

      const doc = (await payload.findByID({
        id: target.id,
        collection: target.collection,
        depth: 0,
        disableErrors: true,
        overrideAccess: true,
        req,
      })) as null | Row

      const productDoc =
        variant === null || product === null
          ? null
          : ((await payload.findByID({
              id: product,
              collection: config.productsSlug,
              depth: 0,
              disableErrors: true,
              overrideAccess: true,
              req,
            })) as null | Row)

      const unitPrice = doc === null ? 0 : (priceOf(doc, currency) ?? 0)
      const description =
        (productDoc === null ? '' : titleOf(productDoc)) || (doc === null ? '' : titleOf(doc)) ||
        String(target.id)

      lines.push({
        description: variant === null || doc === null ? description : `${description} ${titleOf(doc)}`.trim(),
        lineTotal: unitPrice * quantity,
        ...(product === null ? {} : { product: String(product) }),
        quantity,
        ...(doc === null || str(doc.sku).length === 0 ? {} : { sku: str(doc.sku) }),
        unitPrice,
        ...(variant === null ? {} : { variant: String(variant) }),
      })
    }

    return lines
  }
