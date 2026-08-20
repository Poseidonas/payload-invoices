import type { CollectionConfig, Config, Endpoint, Field } from 'payload'
import { describe, expect, it } from 'vitest'

import { invoicesCollection } from '../src/collection.js'
import { resolveConfig, toParty } from '../src/config.js'
import { InvoiceError } from '../src/errors.js'
import { invoicesPlugin } from '../src/index.js'
import { partyFromAddress } from '../src/snapshot.js'
import { fakePayload, request } from './fake.js'

const config = resolveConfig()

const orders = (): CollectionConfig => ({ slug: 'orders', fields: [{ name: 'status', type: 'text' }] })

const build = (incoming = {}): Config =>
  invoicesPlugin(incoming)({ collections: [orders()] } as unknown as Config)

const slugs = (result: Config): string[] => (result.collections ?? []).map((entry) => entry.slug)

describe('invoicesPlugin', () => {
  it('returns the config untouched when there is no orders collection', () => {
    const incoming = { collections: [{ slug: 'pages', fields: [] }] } as unknown as Config

    expect(invoicesPlugin()(incoming)).toBe(incoming)
  })

  it('adds the invoices collection and its counters', () => {
    expect(slugs(build())).toEqual(['orders', 'invoices', 'invoice-counters'])
  })

  it('names both collections from the options', () => {
    const result = build({ countersSlug: 'seq', invoicesSlug: 'legal-invoices' })

    expect(slugs(result)).toEqual(['orders', 'legal-invoices', 'seq'])
  })

  it('adds no hook to the orders collection by default', () => {
    expect(build().collections?.[0]?.hooks?.afterChange).toBeUndefined()
  })

  it('adds one hook to the orders collection when a status issues automatically', () => {
    const result = build({ autoIssueOnStatus: ['completed'] })

    expect(result.collections?.[0]?.hooks?.afterChange).toHaveLength(1)
  })

  it('adds no hook when disabled, but keeps the collections', () => {
    const result = build({ autoIssueOnStatus: ['completed'], disabled: true })

    expect(result.collections?.[0]?.hooks?.afterChange).toBeUndefined()
    expect(slugs(result)).toHaveLength(3)
  })

  it('reads the orders slug from the options', () => {
    const result = invoicesPlugin({ ordersSlug: 'sales' })({
      collections: [{ slug: 'sales', fields: [] }],
    } as unknown as Config)

    expect(slugs(result)).toContain('invoices')
  })
})

describe('the invoices collection', () => {
  const collection = invoicesCollection(config)

  const field = (name: string): Field | undefined =>
    collection.fields.find((entry) => 'name' in entry && entry.name === name)

  it('is closed to update and delete through the API', () => {
    expect(collection.access?.update?.({} as never)).toBe(false)
    expect(collection.access?.delete?.({} as never)).toBe(false)
  })

  it('refuses creation through the API by default, because issuing is a function call', () => {
    expect(collection.access?.create?.({ req: { user: { id: 1 } } } as never)).toBe(false)
  })

  it('lets a signed in user read', () => {
    expect(collection.access?.read?.({ req: { user: { id: 1 } } } as never)).toBe(true)
    expect(collection.access?.read?.({ req: { user: null } } as never)).toBe(false)
  })

  it('accepts a create access of its own', () => {
    const open = invoicesCollection(resolveConfig({ createAccess: () => true }))

    expect(open.access?.create?.({} as never)).toBe(true)
  })

  it('closes every field to update', () => {
    const open = collection.fields.filter((entry) => {
      const access = (entry as { access?: { update?: (args: never) => unknown } }).access

      return 'name' in entry && access?.update?.({} as never) !== false
    })

    expect(open).toEqual([])
  })

  it('puts a unique index on the number, which is the final guarantee', () => {
    expect((field('number') as { unique?: boolean }).unique).toBe(true)
    expect((field('number') as { index?: boolean }).index).toBe(true)
  })

  it('requires the number, the series, the year, the sequence and the total', () => {
    for (const name of ['number', 'series', 'year', 'sequence', 'total', 'issuedAt', 'kind']) {
      expect((field(name) as { required?: boolean }).required).toBe(true)
    }
  })

  it('refuses an update inside its own hook, which catches a Local API call', () => {
    const hook = collection.hooks?.beforeChange?.[0]

    expect(() => hook?.({ operation: 'update' } as never)).toThrow(InvoiceError)
  })

  it('lets a create through that hook', () => {
    const hook = collection.hooks?.beforeChange?.[0]

    expect(hook?.({ operation: 'create' } as never)).toBeUndefined()
  })

  it('offers both kinds of document', () => {
    const options = (field('kind') as { options?: { value: string }[] }).options ?? []

    expect(options.map((option) => option.value)).toEqual(['invoice', 'credit-note'])
  })

  it('keeps the refund as plain text when no refunds collection is named', () => {
    expect((field('refund') as { type: string }).type).toBe('text')
  })

  it('makes the refund a relationship when a refunds collection is named', () => {
    const linked = invoicesCollection(resolveConfig({ refundsSlug: 'refunds' }))
    const refund = linked.fields.find((entry) => 'name' in entry && entry.name === 'refund')

    expect((refund as { relationTo?: string }).relationTo).toBe('refunds')
  })

  it('carries the same fields on both parties', () => {
    const seller = field('seller') as { fields: Field[] }
    const buyer = field('buyer') as { fields: Field[] }

    expect(seller.fields.map((entry) => ('name' in entry ? entry.name : ''))).toEqual(
      buyer.fields.map((entry) => ('name' in entry ? entry.name : '')),
    )
  })

  it('carries a line shape that holds everything the renderer needs', () => {
    const lines = field('lines') as { fields: Field[] }

    expect(lines.fields.map((entry) => ('name' in entry ? entry.name : ''))).toEqual([
      'description',
      'sku',
      'quantity',
      'unitPrice',
      'lineTotal',
      'product',
      'variant',
    ])
  })

  it('serves the PDF from its own endpoint', () => {
    const endpoints = collection.endpoints as Endpoint[]

    expect(endpoints).toHaveLength(1)
    expect(endpoints[0]).toMatchObject({ method: 'get', path: '/:id/pdf' })
  })
})

describe('the PDF endpoint', () => {
  const collection = invoicesCollection(config)
  const handler = (collection.endpoints as Endpoint[])[0]?.handler

  const withInvoice = () =>
    fakePayload({
      invoices: [
        {
          buyer: { name: 'Acme Ltd' },
          currency: 'EUR',
          decimals: 2,
          id: 7,
          issuedAt: '2026-08-19T00:00:00.000Z',
          kind: 'invoice',
          lines: [{ description: 'Widget', lineTotal: 6000, quantity: 2, unitPrice: 3000 }],
          net: 6000,
          number: 'INV-2026-00001',
          seller: { name: 'My Shop' },
          tax: 0,
          total: 6000,
        },
      ],
    })

  it('answers with PDF bytes', async () => {
    const payload = withInvoice()
    const req = { ...(request(payload) as object), routeParams: { id: '7' } }
    const response = (await handler?.(req as never)) as Response

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/pdf')

    const bytes = Buffer.from(await response.arrayBuffer())

    expect(bytes.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4')
  })

  it('names the file after the invoice number', async () => {
    const payload = withInvoice()
    const req = { ...(request(payload) as object), routeParams: { id: '7' } }
    const response = (await handler?.(req as never)) as Response

    expect(response.headers.get('Content-Disposition')).toBe(
      'inline; filename="INV-2026-00001.pdf"',
    )
  })

  it('answers 404 for an invoice that does not exist', async () => {
    const payload = withInvoice()
    const req = { ...(request(payload) as object), routeParams: { id: '99' } }
    const response = (await handler?.(req as never)) as Response

    expect(response.status).toBe(404)
  })

  it('answers 404 when no identifier reaches it', async () => {
    const payload = withInvoice()
    const req = { ...(request(payload) as object), routeParams: {} }
    const response = (await handler?.(req as never)) as Response

    expect(response.status).toBe(404)
  })

  it('uses a renderer given in the options', async () => {
    const custom = invoicesCollection(
      resolveConfig({ renderer: () => new Uint8Array([1, 2, 3]) }),
    )
    const payload = withInvoice()
    const req = { ...(request(payload) as object), routeParams: { id: '7' } }
    const endpoint = (custom.endpoints as Endpoint[])[0]
    const response = (await endpoint?.handler?.(req as never)) as Response
    const bytes = Buffer.from(await response.arrayBuffer())

    expect([...bytes]).toEqual([1, 2, 3])
  })
})

describe('parties', () => {
  it('takes the company as the name when there is one', () => {
    expect(partyFromAddress({ company: 'Acme Ltd', firstName: 'Maria' }).name).toBe('Acme Ltd')
  })

  it('joins the two personal names when there is no company', () => {
    expect(partyFromAddress({ firstName: 'Maria', lastName: 'Papadopoulou' }).name).toBe(
      'Maria Papadopoulou',
    )
  })

  it('accepts a first name on its own', () => {
    expect(partyFromAddress({ firstName: 'Maria' }).name).toBe('Maria')
  })

  it('leaves the name out when the address carries none', () => {
    expect(partyFromAddress({ city: 'Athens' }).name).toBeUndefined()
  })

  it('leaves an empty field out rather than storing an empty string', () => {
    expect(partyFromAddress({ addressLine2: '   ', city: 'Athens' })).toEqual({ city: 'Athens' })
  })

  it('is empty for anything that is not an address', () => {
    expect(partyFromAddress(null)).toEqual({})
    expect(partyFromAddress('x')).toEqual({})
  })

  it('carries every address field the official plugin defines across', () => {
    const party = partyFromAddress({
      addressLine1: 'Odos 12',
      addressLine2: 'Floor 3',
      city: 'Athens',
      country: 'GR',
      firstName: 'Maria',
      lastName: 'Papadopoulou',
      phone: '210',
      postalCode: '11527',
      state: 'Attica',
      title: 'Home',
    })

    expect(party).toEqual({
      addressLine1: 'Odos 12',
      addressLine2: 'Floor 3',
      city: 'Athens',
      country: 'GR',
      name: 'Maria Papadopoulou',
      phone: '210',
      postalCode: '11527',
      state: 'Attica',
    })
  })

  it('keeps only the fields a party may hold', () => {
    expect(toParty({ name: 'A', secret: 'B' })).toEqual({ name: 'A' })
  })

  it('drops a field that is not text', () => {
    expect(toParty({ name: 5, vatNumber: 'EL1' })).toEqual({ vatNumber: 'EL1' })
  })
})
