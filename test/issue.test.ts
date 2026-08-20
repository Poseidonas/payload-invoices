import { describe, expect, it } from 'vitest'

import { resolveConfig } from '../src/config.js'
import { InvoiceError, refusalCodes } from '../src/errors.js'
import { decimalsFor, issueCreditNote, issueInvoice, reconcile } from '../src/issue.js'
import type { InvoicesConfig } from '../src/types.js'
import { fakePayload, request } from './fake.js'

const seller = { name: 'My Shop', vatNumber: 'EL999999999' }

const options = (extra: InvoicesConfig = {}): InvoicesConfig => ({ seller, ...extra })

const store = (order: Record<string, unknown> = {}) =>
  fakePayload({
    invoices: [],
    'invoice-counters': [],
    orders: [
      {
        amount: 6000,
        currency: 'EUR',
        customerEmail: 'buyer@example.com',
        id: 1,
        items: [
          { id: 'a', product: 10, quantity: 2 },
          { id: 'b', product: 11, quantity: 1, variant: 20 },
        ],
        shippingAddress: {
          addressLine1: 'Odos 12',
          city: 'Athens',
          country: 'GR',
          firstName: 'Maria',
          lastName: 'Papadopoulou',
          postalCode: '11527',
        },
        status: 'processing',
        transactions: [50],
        ...order,
      },
    ],
    products: [
      { id: 10, priceInEUR: 2000, title: 'Widget' },
      { id: 11, priceInEUR: 500, title: 'Sprocket' },
    ],
    transactions: [
      {
        billingAddress: {
          addressLine1: 'Billing 9',
          city: 'Piraeus',
          company: 'Acme Ltd',
          country: 'GR',
          postalCode: '18531',
        },
        id: 50,
      },
    ],
    users: [{ email: 'signed@example.com', id: 3, vatNumber: 'EL111111111' }],
    variants: [{ id: 20, priceInEUR: 500, sku: 'SPR-BLUE', title: 'Blue' }],
  })

const codeOf = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run()
  } catch (error) {
    return error instanceof InvoiceError ? error.code : 'not-an-invoice-error'
  }

  return 'no-error'
}

describe('decimalsFor', () => {
  const config = resolveConfig()

  it('knows the three currencies the official plugin ships', () => {
    expect(decimalsFor('EUR', config)).toBe(2)
    expect(decimalsFor('USD', config)).toBe(2)
    expect(decimalsFor('GBP', config)).toBe(2)
  })

  it('reads a currency code in lower case', () => {
    expect(decimalsFor('eur', config)).toBe(2)
  })

  it('falls back for a currency it does not know', () => {
    expect(decimalsFor('JPY', config)).toBe(2)
  })

  it('takes a currency given in the options', () => {
    expect(decimalsFor('JPY', resolveConfig({ decimals: { JPY: 0 } }))).toBe(0)
  })

  it('takes a fallback given in the options', () => {
    expect(decimalsFor('KWD', resolveConfig({ defaultDecimals: 3 }))).toBe(3)
  })
})

describe('reconcile', () => {
  const config = resolveConfig()
  const line = { description: 'Widget', lineTotal: 4000, quantity: 2, unitPrice: 2000 }

  it('leaves lines that already add up alone', () => {
    expect(reconcile([line], 4000, config)).toEqual([line])
  })

  it('adds one labelled line for a shortfall', () => {
    const result = reconcile([line], 6000, config)

    expect(result).toHaveLength(2)
    expect(result[1]).toEqual({
      description: 'Adjustment',
      lineTotal: 2000,
      quantity: 1,
      unitPrice: 2000,
    })
  })

  it('adds a negative line when the lines are worth more than was charged', () => {
    expect(reconcile([line], 3500, config)[1]?.lineTotal).toBe(-500)
  })

  it('never changes a line it was given', () => {
    const result = reconcile([line], 9000, config)

    expect(result[0]).toEqual(line)
  })

  it('makes the lines add up exactly', () => {
    const result = reconcile([line], 6001, config)
    const total = result.reduce((sum, entry) => sum + entry.lineTotal, 0)

    expect(total).toBe(6001)
  })

  it('uses the label from the options', () => {
    const named = resolveConfig({ adjustmentLabel: 'Shipping and discounts' })

    expect(reconcile([line], 5000, named)[1]?.description).toBe('Shipping and discounts')
  })

  it('refuses instead when told to', () => {
    const strict = resolveConfig({ onLineMismatch: 'refuse' })

    expect(() => reconcile([line], 5000, strict)).toThrow(InvoiceError)
  })

  it('accepts a matching total even when told to refuse', () => {
    const strict = resolveConfig({ onLineMismatch: 'refuse' })

    expect(reconcile([line], 4000, strict)).toEqual([line])
  })

  it('adds a line for the whole amount when there are none', () => {
    expect(reconcile([], 6000, config)[0]?.lineTotal).toBe(6000)
  })
})

describe('issueInvoice', () => {
  it('issues the first invoice of the series', async () => {
    const payload = store()
    const invoice = await issueInvoice(payload as never, {
      config: options(),
      order: 1,
      req: request(payload),
    })

    expect(invoice.number).toBe(`INV-${new Date().getUTCFullYear()}-00001`)
    expect(invoice.sequence).toBe(1)
    expect(invoice.kind).toBe('invoice')
  })

  it('counts on from there, with no gap', async () => {
    const payload = store()
    const req = request(payload)
    const numbers: unknown[] = []

    for (let index = 0; index < 5; index += 1) {
      const invoice = await issueInvoice(payload as never, {
        allowDuplicate: true,
        config: options(),
        order: 1,
        req,
      })

      numbers.push(invoice.sequence)
    }

    expect(numbers).toEqual([1, 2, 3, 4, 5])
  })

  it('takes the total from the order, never from the lines', async () => {
    const payload = store()
    const invoice = await issueInvoice(payload as never, {
      config: options(),
      order: 1,
      req: request(payload),
    })

    expect(invoice.total).toBe(6000)
  })

  it('makes the lines add up to the total with one adjustment line', async () => {
    const payload = store()
    const invoice = await issueInvoice(payload as never, {
      config: options(),
      order: 1,
      req: request(payload),
    })
    const lines = invoice.lines as { description: string; lineTotal: number }[]
    const summed = lines.reduce((total, line) => total + line.lineTotal, 0)

    expect(summed).toBe(6000)
    expect(lines.at(-1)?.description).toBe('Adjustment')
  })

  it('prices each line from the product in the order currency', async () => {
    const payload = store()
    const invoice = await issueInvoice(payload as never, {
      config: options(),
      order: 1,
      req: request(payload),
    })
    const lines = invoice.lines as { lineTotal: number; unitPrice: number }[]

    expect(lines[0]?.unitPrice).toBe(2000)
    expect(lines[0]?.lineTotal).toBe(4000)
  })

  it('prices a line with a variant from the variant', async () => {
    const payload = store()
    const invoice = await issueInvoice(payload as never, {
      config: options(),
      order: 1,
      req: request(payload),
    })
    const lines = invoice.lines as { description: string; sku?: string }[]

    expect(lines[1]?.description).toBe('Sprocket Blue')
    expect(lines[1]?.sku).toBe('SPR-BLUE')
  })

  it('reports the whole total as net at a rate of zero', async () => {
    const payload = store()
    const invoice = await issueInvoice(payload as never, {
      config: options(),
      order: 1,
      req: request(payload),
    })

    expect(invoice.net).toBe(6000)
    expect(invoice.tax).toBe(0)
  })

  it('splits the total at the configured rate without changing it', async () => {
    const payload = store()
    const invoice = await issueInvoice(payload as never, {
      config: options({ taxRate: 24 }),
      order: 1,
      req: request(payload),
    })

    expect(invoice.net).toBe(4839)
    expect(invoice.tax).toBe(1161)
    expect((invoice.net as number) + (invoice.tax as number)).toBe(invoice.total)
  })

  it('takes a rate given for this invoice only', async () => {
    const payload = store()
    const invoice = await issueInvoice(payload as never, {
      config: options({ taxRate: 24 }),
      order: 1,
      req: request(payload),
      taxRate: 0,
    })

    expect(invoice.tax).toBe(0)
  })

  it('freezes the seller from the options', async () => {
    const payload = store()
    const invoice = await issueInvoice(payload as never, {
      config: options(),
      order: 1,
      req: request(payload),
    })

    expect(invoice.seller).toEqual(seller)
  })

  it('lets the caller override the seller for one invoice', async () => {
    const payload = store()
    const invoice = await issueInvoice(payload as never, {
      config: options(),
      order: 1,
      req: request(payload),
      seller: { name: 'Second Branch' },
    })

    expect((invoice.seller as { name: string }).name).toBe('Second Branch')
  })

  it('refuses to issue without a seller name', async () => {
    const payload = store()

    expect(
      await codeOf(() => issueInvoice(payload as never, { order: 1, req: request(payload) })),
    ).toBe(refusalCodes.NoSeller)
  })

  it('refuses an order that does not exist', async () => {
    const payload = store()

    expect(
      await codeOf(() =>
        issueInvoice(payload as never, { config: options(), order: 99, req: request(payload) }),
      ),
    ).toBe(refusalCodes.OrderNotFound)
  })

  it('refuses a second invoice for the same order', async () => {
    const payload = store()
    const req = request(payload)

    await issueInvoice(payload as never, { config: options(), order: 1, req })

    expect(
      await codeOf(() => issueInvoice(payload as never, { config: options(), order: 1, req })),
    ).toBe(refusalCodes.AlreadyIssued)
  })

  it('issues a second invoice when asked explicitly', async () => {
    const payload = store()
    const req = request(payload)

    await issueInvoice(payload as never, { config: options(), order: 1, req })
    const second = await issueInvoice(payload as never, {
      allowDuplicate: true,
      config: options(),
      order: 1,
      req,
    })

    expect(second.sequence).toBe(2)
  })

  it('refuses an order whose amount is not whole minor units', async () => {
    const payload = store({ amount: 60.5 })

    expect(
      await codeOf(() =>
        issueInvoice(payload as never, { config: options(), order: 1, req: request(payload) }),
      ),
    ).toBe(refusalCodes.InvalidAmount)
  })

  it('leaves no gap when the document cannot be written', async () => {
    const payload = store()
    const req = request(payload)

    await issueInvoice(payload as never, { config: options(), allowDuplicate: true, order: 1, req })

    const failing = { ...payload, create: () => Promise.reject(new Error('write failed')) }

    await expect(
      issueInvoice(failing as never, { allowDuplicate: true, config: options(), order: 1, req }),
    ).rejects.toThrow('write failed')

    const next = await issueInvoice(payload as never, {
      allowDuplicate: true,
      config: options(),
      order: 1,
      req,
    })

    expect(next.sequence).toBe(2)
  })

  it('takes the buyer address from the transaction billing address by default', async () => {
    const payload = store()
    const invoice = await issueInvoice(payload as never, {
      config: options(),
      order: 1,
      req: request(payload),
    })

    expect((invoice.buyer as { name: string }).name).toBe('Acme Ltd')
  })

  it('takes the shipping address when told to', async () => {
    const payload = store()
    const invoice = await issueInvoice(payload as never, {
      config: options({ buyerAddressSource: 'shipping' }),
      order: 1,
      req: request(payload),
    })

    expect((invoice.buyer as { name: string }).name).toBe('Maria Papadopoulou')
  })

  it('lets the caller override the buyer', async () => {
    const payload = store()
    const invoice = await issueInvoice(payload as never, {
      buyer: { name: 'Given By Hand', vatNumber: 'EL222222222' },
      config: options(),
      order: 1,
      req: request(payload),
    })

    expect(invoice.buyer).toMatchObject({ name: 'Given By Hand', vatNumber: 'EL222222222' })
  })

  it('records the currency and its minor unit digits', async () => {
    const payload = store()
    const invoice = await issueInvoice(payload as never, {
      config: options(),
      order: 1,
      req: request(payload),
    })

    expect(invoice.currency).toBe('EUR')
    expect(invoice.decimals).toBe(2)
  })

  it('records a due date when given one', async () => {
    const payload = store()
    const invoice = await issueInvoice(payload as never, {
      config: options(),
      dueAt: '2026-09-18T00:00:00.000Z',
      order: 1,
      req: request(payload),
    })

    expect(invoice.dueAt).toBe('2026-09-18T00:00:00.000Z')
  })

  it('uses lines given by the caller instead of the products', async () => {
    const payload = store()
    const invoice = await issueInvoice(payload as never, {
      config: options(),
      lines: [{ description: 'One service', lineTotal: 6000, quantity: 1, unitPrice: 6000 }],
      order: 1,
      req: request(payload),
    })

    expect(invoice.lines).toHaveLength(1)
  })

  it('uses a line resolver given in the options', async () => {
    const payload = store()
    const invoice = await issueInvoice(payload as never, {
      config: options({
        resolveLines: () => [
          { description: 'Fixed', lineTotal: 3000, quantity: 1, unitPrice: 3000 },
        ],
      }),
      order: 1,
      req: request(payload),
    })
    const lines = invoice.lines as { description: string }[]

    expect(lines[0]?.description).toBe('Fixed')
    expect(lines).toHaveLength(2)
  })

  it('writes the year the sequence belongs to', async () => {
    const payload = store()
    const invoice = await issueInvoice(payload as never, {
      config: options(),
      issuedAt: '2026-03-04T00:00:00.000Z',
      order: 1,
      req: request(payload),
    })

    expect(invoice.year).toBe(2026)
    expect(invoice.number).toBe('INV-2026-00001')
  })

  it('starts a new sequence in a new year', async () => {
    const payload = store()
    const req = request(payload)

    await issueInvoice(payload as never, {
      allowDuplicate: true,
      config: options(),
      issuedAt: '2026-12-31T00:00:00.000Z',
      order: 1,
      req,
    })
    const next = await issueInvoice(payload as never, {
      allowDuplicate: true,
      config: options(),
      issuedAt: '2027-01-01T00:00:00.000Z',
      order: 1,
      req,
    })

    expect(next.number).toBe('INV-2027-00001')
  })

  it('keeps one sequence forever when the yearly reset is off', async () => {
    const payload = store()
    const req = request(payload)
    const config = options({ resetYearly: false })

    await issueInvoice(payload as never, {
      allowDuplicate: true,
      config,
      issuedAt: '2026-12-31T00:00:00.000Z',
      order: 1,
      req,
    })
    const next = await issueInvoice(payload as never, {
      allowDuplicate: true,
      config,
      issuedAt: '2027-01-01T00:00:00.000Z',
      order: 1,
      req,
    })

    expect(next.sequence).toBe(2)
  })
})

describe('the frozen snapshot', () => {
  it('does not change when the product price changes afterwards', async () => {
    const payload = store()
    const invoice = await issueInvoice(payload as never, {
      config: options(),
      order: 1,
      req: request(payload),
    })
    const before = JSON.stringify(invoice.lines)
    const product = payload.collections.products?.[0]

    if (product) {
      product.priceInEUR = 999999
      product.title = 'Renamed'
    }

    const stored = payload.collections.invoices?.[0]

    expect(JSON.stringify(stored?.lines)).toBe(before)
  })

  it('does not change when the order is edited afterwards', async () => {
    const payload = store()

    await issueInvoice(payload as never, { config: options(), order: 1, req: request(payload) })

    const order = payload.collections.orders?.[0]

    if (order) {
      order.amount = 1
      order.shippingAddress = {}
    }

    expect(payload.collections.invoices?.[0]?.total).toBe(6000)
  })

  it('does not change when the customer record is deleted afterwards', async () => {
    const payload = store({ customer: 3, customerEmail: undefined })

    await issueInvoice(payload as never, { config: options(), order: 1, req: request(payload) })

    payload.collections.users = []

    expect((payload.collections.invoices?.[0]?.buyer as { email?: string }).email).toBe(
      'signed@example.com',
    )
  })
})

describe('issueCreditNote', () => {
  const issued = async () => {
    const payload = store()
    const req = request(payload)
    const invoice = await issueInvoice(payload as never, { config: options(), order: 1, req })

    return { invoice, payload, req }
  }

  it('credits the whole invoice by default', async () => {
    const { invoice, payload, req } = await issued()
    const note = await issueCreditNote(payload as never, {
      config: options(),
      invoice: invoice.id as number,
      req,
    })

    expect(note.total).toBe(6000)
    expect(note.kind).toBe('credit-note')
  })

  it('numbers credit notes in their own series', async () => {
    const { invoice, payload, req } = await issued()
    const note = await issueCreditNote(payload as never, {
      config: options(),
      invoice: invoice.id as number,
      req,
    })

    expect(note.series).toBe('CN')
    expect(String(note.number).startsWith('CN-')).toBe(true)
    expect(note.sequence).toBe(1)
  })

  it('puts credit notes in the invoice sequence when the series match', async () => {
    const { invoice, payload, req } = await issued()
    const shared = options({ creditNoteSeries: 'INV' })
    const note = await issueCreditNote(payload as never, {
      config: shared,
      invoice: invoice.id as number,
      req,
    })

    expect(note.sequence).toBe(2)
  })

  it('names the invoice it credits, by relationship and by number', async () => {
    const { invoice, payload, req } = await issued()
    const note = await issueCreditNote(payload as never, {
      config: options(),
      invoice: invoice.id as number,
      req,
    })

    expect(note.creditedInvoice).toBe(invoice.id)
    expect(note.creditedNumber).toBe(invoice.number)
  })

  it('copies the frozen parties from the invoice', async () => {
    const { invoice, payload, req } = await issued()
    const note = await issueCreditNote(payload as never, {
      config: options(),
      invoice: invoice.id as number,
      req,
    })

    expect(note.seller).toEqual(invoice.seller)
    expect(note.buyer).toEqual(invoice.buyer)
  })

  it('credits a part of the invoice', async () => {
    const { invoice, payload, req } = await issued()
    const note = await issueCreditNote(payload as never, {
      amount: 2500,
      config: options(),
      invoice: invoice.id as number,
      req,
    })

    expect(note.total).toBe(2500)
  })

  it('refuses more than the invoice is worth', async () => {
    const { invoice, payload, req } = await issued()

    expect(
      await codeOf(() =>
        issueCreditNote(payload as never, {
          amount: 6001,
          config: options(),
          invoice: invoice.id as number,
          req,
        }),
      ),
    ).toBe(refusalCodes.OverCredited)
  })

  it('refuses more than is left after an earlier credit note', async () => {
    const { invoice, payload, req } = await issued()

    await issueCreditNote(payload as never, {
      amount: 4000,
      config: options(),
      invoice: invoice.id as number,
      req,
    })

    expect(
      await codeOf(() =>
        issueCreditNote(payload as never, {
          amount: 2001,
          config: options(),
          invoice: invoice.id as number,
          req,
        }),
      ),
    ).toBe(refusalCodes.OverCredited)
  })

  it('accepts exactly what is left', async () => {
    const { invoice, payload, req } = await issued()

    await issueCreditNote(payload as never, {
      amount: 4000,
      config: options(),
      invoice: invoice.id as number,
      req,
    })
    const second = await issueCreditNote(payload as never, {
      amount: 2000,
      config: options(),
      invoice: invoice.id as number,
      req,
    })

    expect(second.total).toBe(2000)
  })

  it('refuses a zero or negative credit note', async () => {
    const { invoice, payload, req } = await issued()

    for (const amount of [0, -1]) {
      expect(
        await codeOf(() =>
          issueCreditNote(payload as never, {
            amount,
            config: options(),
            invoice: invoice.id as number,
            req,
          }),
        ),
      ).toBe(refusalCodes.InvalidAmount)
    }
  })

  it('refuses a fractional credit note', async () => {
    const { invoice, payload, req } = await issued()

    expect(
      await codeOf(() =>
        issueCreditNote(payload as never, {
          amount: 10.5,
          config: options(),
          invoice: invoice.id as number,
          req,
        }),
      ),
    ).toBe(refusalCodes.InvalidAmount)
  })

  it('refuses an invoice that does not exist', async () => {
    const payload = store()

    expect(
      await codeOf(() =>
        issueCreditNote(payload as never, { config: options(), invoice: 999, req: request(payload) }),
      ),
    ).toBe(refusalCodes.InvoiceNotFound)
  })

  it('refuses to credit a credit note', async () => {
    const { invoice, payload, req } = await issued()
    const note = await issueCreditNote(payload as never, {
      config: options(),
      invoice: invoice.id as number,
      req,
    })

    expect(
      await codeOf(() =>
        issueCreditNote(payload as never, { config: options(), invoice: note.id as number, req }),
      ),
    ).toBe(refusalCodes.InvoiceNotFound)
  })

  it('splits the credited amount at the rate of the original invoice', async () => {
    const payload = store()
    const req = request(payload)
    const invoice = await issueInvoice(payload as never, {
      config: options({ taxRate: 24 }),
      order: 1,
      req,
    })
    const note = await issueCreditNote(payload as never, {
      amount: 1000,
      config: options({ taxRate: 24 }),
      invoice: invoice.id as number,
      req,
    })

    expect((note.net as number) + (note.tax as number)).toBe(1000)
    expect(note.taxRate).toBe(24)
  })

  it('records the refund it belongs to when given one', async () => {
    const { invoice, payload, req } = await issued()
    const note = await issueCreditNote(payload as never, {
      config: options(),
      invoice: invoice.id as number,
      refund: 'refund-77',
      req,
    })

    expect(note.refund).toBe('refund-77')
  })

  it('writes one line describing the credit by default', async () => {
    const { invoice, payload, req } = await issued()
    const note = await issueCreditNote(payload as never, {
      config: options(),
      invoice: invoice.id as number,
      req,
    })
    const lines = note.lines as { description: string; lineTotal: number }[]

    expect(lines).toHaveLength(1)
    expect(lines[0]?.lineTotal).toBe(6000)
    expect(lines[0]?.description).toContain(String(invoice.number))
  })

  it('accepts lines from the caller and makes them add up', async () => {
    const { invoice, payload, req } = await issued()
    const note = await issueCreditNote(payload as never, {
      amount: 4000,
      config: options(),
      invoice: invoice.id as number,
      lines: [{ description: 'Widget returned', lineTotal: 4000, quantity: 2, unitPrice: 2000 }],
      req,
    })
    const lines = note.lines as { lineTotal: number }[]

    expect(lines.reduce((total, line) => total + line.lineTotal, 0)).toBe(4000)
  })
})
