/**
 * Thrown when an invoice cannot be issued. Carries `status` 400 and
 * `isPublic`, which Payload reads to answer the request with the message
 * rather than a generic server error.
 */
export class InvoiceError extends Error {
  readonly code: string

  readonly detail: Record<string, unknown>

  readonly isPublic = true

  readonly status = 400

  constructor(code: string, message: string, detail: Record<string, unknown> = {}) {
    super(message)

    this.code = code
    this.detail = detail
    this.name = 'InvoiceError'
  }
}

export const refusalCodes = {
  AlreadyIssued: 'AlreadyIssued',
  Immutable: 'InvoiceImmutable',
  InvalidAmount: 'InvalidAmount',
  InvoiceNotFound: 'InvoiceNotFound',
  NoSeller: 'NoSeller',
  NumberUnavailable: 'NumberUnavailable',
  OrderNotFound: 'OrderNotFound',
  OverCredited: 'OverCredited',
  TotalMismatch: 'TotalMismatch',
} as const

export type RefusalCode = (typeof refusalCodes)[keyof typeof refusalCodes]
