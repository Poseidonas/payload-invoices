import { describe, expect, it } from 'vitest'

import { resolveConfig } from '../src/config.js'
import { renderInvoice, numericWidth, truncate } from '../src/render.js'

describe('resolveConfig defaults', () => {
  const config = resolveConfig()

  it('uses the official collection slugs', () => {
    expect(config.ordersSlug).toBe('orders')
    expect(config.productsSlug).toBe('products')
    expect(config.variantsSlug).toBe('variants')
    expect(config.transactionsSlug).toBe('transactions')
    expect(config.customersSlug).toBe('users')
  })

  it('names its own collections', () => {
    expect(config.invoicesSlug).toBe('invoices')
    expect(config.countersSlug).toBe('invoice-counters')
  })

  it('gives invoices and credit notes separate series', () => {
    expect(config.series).toBe('INV')
    expect(config.creditNoteSeries).toBe('CN')
  })

  it('starts at one, padded to five digits, resetting each year', () => {
    expect(config.startAt).toBe(1)
    expect(config.padding).toBe(5)
    expect(config.resetYearly).toBe(true)
  })

  it('reports the whole amount as net until a rate is given', () => {
    expect(config.taxRate).toBe(0)
  })

  it('adjusts rather than refusing when the lines do not add up', () => {
    expect(config.onLineMismatch).toBe('adjust')
    expect(config.adjustmentLabel).toBe('Adjustment')
  })

  it('issues nothing automatically', () => {
    expect(config.autoIssueOnStatus).toEqual([])
  })

  it('has no seller until one is given', () => {
    expect(config.seller).toEqual({})
  })

  it('reads the buyer address from the billing address', () => {
    expect(config.buyerAddressSource).toBe('billing')
    expect(config.buyerVatFieldName).toBe('vatNumber')
  })

  it('knows two minor unit digits for the three shipped currencies', () => {
    expect(config.decimals).toMatchObject({ EUR: 2, GBP: 2, USD: 2 })
    expect(config.defaultDecimals).toBe(2)
  })

  it('uses the built-in renderer and line resolver', () => {
    expect(config.renderer).toBeNull()
    expect(config.resolveLines).toBeNull()
  })

  it('links no refunds collection', () => {
    expect(config.refundsSlug).toBe('')
  })
})

describe('resolveConfig replaces values it cannot use', () => {
  it('replaces an empty slug with its default', () => {
    expect(resolveConfig({ invoicesSlug: '' }).invoicesSlug).toBe('invoices')
  })

  it('replaces a zero startAt with its default', () => {
    expect(resolveConfig({ startAt: 0 }).startAt).toBe(1)
  })

  it('replaces a negative startAt with its default, never its absolute value', () => {
    expect(resolveConfig({ startAt: -5 }).startAt).toBe(1)
  })

  it('truncates a fractional startAt', () => {
    expect(resolveConfig({ startAt: 4.9 }).startAt).toBe(4)
  })

  it('accepts a padding of zero, which pads nothing', () => {
    expect(resolveConfig({ padding: 0 }).padding).toBe(0)
  })

  it('replaces a negative padding with its default', () => {
    expect(resolveConfig({ padding: -3 }).padding).toBe(5)
  })

  it('replaces a zero attempts with its default', () => {
    expect(resolveConfig({ attempts: 0 }).attempts).toBe(20)
  })

  it('replaces a negative tax rate with zero', () => {
    expect(resolveConfig({ taxRate: -24 }).taxRate).toBe(0)
  })

  it('keeps a fractional tax rate, which is a real rate in some places', () => {
    expect(resolveConfig({ taxRate: 17.5 }).taxRate).toBe(17.5)
  })

  it('only accepts shipping as the other address source', () => {
    expect(resolveConfig({ buyerAddressSource: 'anything' as never }).buyerAddressSource).toBe(
      'billing',
    )
    expect(resolveConfig({ buyerAddressSource: 'shipping' }).buyerAddressSource).toBe('shipping')
  })

  it('only accepts refuse as the other mismatch behaviour', () => {
    expect(resolveConfig({ onLineMismatch: 'explode' as never }).onLineMismatch).toBe('adjust')
  })

  it('drops an empty or non-string status from the automatic list', () => {
    expect(resolveConfig({ autoIssueOnStatus: ['completed', '', 5 as never] }).autoIssueOnStatus).toEqual(
      ['completed'],
    )
  })

  it('keeps only whole, sensible minor unit digits', () => {
    const decimals = resolveConfig({ decimals: { JPY: 0, XXX: -1 as never, YYY: 2.5 as never } })
      .decimals

    expect(decimals.JPY).toBe(0)
    expect(decimals.XXX).toBeUndefined()
    expect(decimals.YYY).toBeUndefined()
  })

  it('upper cases a currency code given in the options', () => {
    expect(resolveConfig({ decimals: { jpy: 0 } }).decimals.JPY).toBe(0)
  })

  it('only disables on exactly true', () => {
    expect(resolveConfig({ disabled: 1 as never }).disabled).toBe(false)
    expect(resolveConfig({ disabled: true }).disabled).toBe(true)
  })

  it('keeps a seller name and drops anything that is not a party field', () => {
    expect(resolveConfig({ seller: { name: 'My Shop', nope: 1 } as never }).seller).toEqual({
      name: 'My Shop',
    })
  })
})

describe('the built-in renderer', () => {
  const invoice = {
    buyer: { city: 'Athens', country: 'GR', name: 'Acme Ltd', postalCode: '11527' },
    currency: 'EUR',
    decimals: 2,
    issuedAt: '2026-08-19T00:00:00.000Z',
    kind: 'invoice',
    lines: [{ description: 'Widget', lineTotal: 6000, quantity: 2, unitPrice: 3000 }],
    net: 4839,
    number: 'INV-2026-00001',
    seller: { name: 'My Shop', vatNumber: 'EL999999999' },
    tax: 1161,
    taxRate: 24,
    total: 6000,
  }

  const body = (doc: Record<string, unknown>): string =>
    Buffer.from(renderInvoice({ decimals: 2, invoice: doc })).toString('latin1')

  it('produces a valid PDF', () => {
    expect(body(invoice).startsWith('%PDF-1.4')).toBe(true)
  })

  it('prints the number', () => {
    expect(body(invoice)).toContain('(INV-2026-00001) Tj')
  })

  it('heads an invoice INVOICE', () => {
    expect(body(invoice)).toContain('(INVOICE) Tj')
  })

  it('heads a credit note CREDIT NOTE', () => {
    expect(body({ ...invoice, kind: 'credit-note' })).toContain('(CREDIT NOTE) Tj')
  })

  it('prints the amounts with their decimal point', () => {
    const printed = body(invoice)

    expect(printed).toContain('(60.00) Tj')
    expect(printed).toContain('(48.39) Tj')
    expect(printed).toContain('(11.61) Tj')
  })

  it('names the rate next to the tax', () => {
    expect(body(invoice)).toContain('(Tax 24%) Tj')
  })

  it('prints the date without the time', () => {
    expect(body(invoice)).toContain('(2026-08-19) Tj')
  })

  it('leaves out a due date it was not given', () => {
    expect(body(invoice)).not.toContain('(Due) Tj')
  })

  it('prints both parties', () => {
    const printed = body(invoice)

    expect(printed).toContain('(My Shop) Tj')
    expect(printed).toContain('(Acme Ltd) Tj')
  })

  it('marks a voided document', () => {
    expect(body({ ...invoice, voidedAt: '2026-08-20T00:00:00.000Z' })).toContain('(VOID) Tj')
  })

  it('renders a document with no lines at all', () => {
    expect(body({ ...invoice, lines: [] }).startsWith('%PDF-1.4')).toBe(true)
  })

  it('renders a document that is almost empty', () => {
    expect(body({}).startsWith('%PDF-1.4')).toBe(true)
  })
})

describe('the renderer helpers', () => {
  it('measures a digit at the Helvetica width', () => {
    expect(numericWidth('1', 10)).toBeCloseTo(5.56)
  })

  it('measures a decimal point narrower than a digit', () => {
    expect(numericWidth('.', 10)).toBeCloseTo(2.78)
  })

  it('measures an empty string as nothing', () => {
    expect(numericWidth('', 10)).toBe(0)
  })

  it('leaves text that fits alone', () => {
    expect(truncate('Widget', 9, 300)).toBe('Widget')
  })

  it('shortens text that does not fit', () => {
    const long = 'x'.repeat(200)

    expect(truncate(long, 9, 100).length).toBeLessThan(long.length)
  })

  it('marks shortened text with a full stop', () => {
    expect(truncate('x'.repeat(200), 9, 100).endsWith('.')).toBe(true)
  })

  it('never returns nothing, however little room there is', () => {
    expect(truncate('abcdef', 9, 0)).toBe('a.')
  })
})
