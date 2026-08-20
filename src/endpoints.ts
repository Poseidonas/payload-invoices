import type { Endpoint } from 'payload'

import { decimalsFor } from './issue.js'
import { renderInvoice } from './render.js'
import type { ResolvedConfig } from './types.js'

const notFound = (): Response =>
  Response.json({ message: 'Not found.' }, { status: 404 })

/**
 * `GET /api/<invoices>/:id/pdf`, answered from the frozen document alone, so
 * the same invoice always produces the same bytes.
 */
export const pdfEndpoint = (config: ResolvedConfig): Endpoint => ({
  handler: async (req) => {
    const id = (req.routeParams as undefined | { id?: unknown })?.id

    if (id === undefined || id === null) {
      return notFound()
    }

    const invoice = (await req.payload.findByID({
      id: String(id),
      collection: config.invoicesSlug,
      depth: 0,
      disableErrors: true,
      req,
    })) as null | Record<string, unknown>

    if (!invoice) {
      return notFound()
    }

    const decimals =
      typeof invoice.decimals === 'number'
        ? invoice.decimals
        : decimalsFor(typeof invoice.currency === 'string' ? invoice.currency : '', config)
    const render = config.renderer ?? renderInvoice
    const bytes = await render({ decimals, invoice })
    const name = typeof invoice.number === 'string' ? invoice.number : String(id)

    return new Response(bytes.slice().buffer as ArrayBuffer, {
      headers: {
        'Content-Disposition': `inline; filename="${name.replace(/[^\w.-]+/g, '-')}.pdf"`,
        'Content-Type': 'application/pdf',
      },
      status: 200,
    })
  },
  method: 'get',
  path: '/:id/pdf',
})
