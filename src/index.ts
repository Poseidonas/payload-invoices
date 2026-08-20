import type { Config } from 'payload'

import { invoicesCollection } from './collection.js'
import { resolveConfig } from './config.js'
import { countersCollection } from './counters.js'
import { issueOnStatus } from './hooks.js'
import type { InvoicesConfig } from './types.js'

export { toParty } from './config.js'
export { claimSequence, countersCollection, releaseSequence } from './counters.js'
export { InvoiceError, refusalCodes } from './errors.js'
export type { RefusalCode } from './errors.js'
export { decimalsFor, issueCreditNote, issueInvoice, reconcile } from './issue.js'
export type { IssueCreditNoteArgs, IssueInvoiceArgs } from './issue.js'
export { formatAmount, splitTax } from './money.js'
export { counterKey, formatNumber } from './numbering.js'
export { contentStream, encodePdf, escapeString, winAnsi } from './pdf.js'
export type { PdfDocument, PdfFont, PdfPage, PdfRule, PdfText } from './pdf.js'
export { renderInvoice } from './render.js'
export { buyerFor, defaultResolveLines, partyFromAddress } from './snapshot.js'
export type {
  InvoiceKind,
  InvoiceLine,
  InvoiceParty,
  InvoiceRenderer,
  InvoicesConfig,
  NumberParts,
  ResolveLines,
} from './types.js'

export const invoicesPlugin =
  (incoming: InvoicesConfig = {}) =>
  (incomingConfig: Config): Config => {
    const config = resolveConfig(incoming)
    const collections = incomingConfig.collections ?? []

    if (!collections.some((collection) => collection.slug === config.ordersSlug)) {
      return incomingConfig
    }

    const attach = config.autoIssueOnStatus.length > 0 && !config.disabled

    return {
      ...incomingConfig,
      collections: [
        ...collections.map((collection) => {
          if (collection.slug !== config.ordersSlug || !attach) {
            return collection
          }

          const hooks = collection.hooks ?? {}

          return {
            ...collection,
            hooks: {
              ...hooks,
              afterChange: [...(hooks.afterChange ?? []), issueOnStatus(config, incoming)],
            },
          }
        }),
        invoicesCollection(config),
        countersCollection(config),
      ],
    }
  }
