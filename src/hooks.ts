import type { CollectionAfterChangeHook } from 'payload'

import { issueInvoice } from './issue.js'
import type { InvoicesConfig, ResolvedConfig } from './types.js'

/**
 * Issues an invoice when an order enters one of the configured statuses.
 * A failure is logged, never thrown, so it cannot stop the order being saved.
 */
export const issueOnStatus =
  (config: ResolvedConfig, incoming: InvoicesConfig): CollectionAfterChangeHook =>
  async ({ doc, previousDoc, req }) => {
    if (config.disabled || config.autoIssueOnStatus.length === 0) {
      return doc
    }

    const record = doc as Record<string, unknown>
    const before = (previousDoc ?? {}) as Record<string, unknown>
    const status = typeof record.status === 'string' ? record.status : ''

    if (!config.autoIssueOnStatus.includes(status) || before.status === status) {
      return doc
    }

    try {
      await issueInvoice(req.payload, {
        config: incoming,
        order: record.id as number | string,
        req,
      })
    } catch (error) {
      req.payload.logger.error({
        err: error,
        msg: `payload-invoices: could not issue an invoice for order ${String(record.id)}`,
      })
    }

    return doc
  }
