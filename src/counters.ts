import type { CollectionConfig, Payload, PayloadRequest } from 'payload'

import { InvoiceError, refusalCodes } from './errors.js'
import { toMinorUnits } from './money.js'
import { counterKey } from './numbering.js'
import type { ResolvedConfig } from './types.js'

const never = (): boolean => false

export const countersCollection = (config: ResolvedConfig): CollectionConfig => ({
  slug: config.countersSlug,
  access: {
    create: never,
    delete: never,
    read: never,
    update: never,
  },
  admin: {
    hidden: true,
  },
  fields: [
    {
      name: 'key',
      type: 'text',
      index: true,
      required: true,
      unique: true,
    },
    {
      name: 'series',
      type: 'text',
      index: true,
      required: true,
    },
    {
      name: 'year',
      type: 'number',
      index: true,
      required: true,
    },
    {
      name: 'next',
      type: 'number',
      required: true,
    },
  ],
})

const readCounter = async (
  payload: Payload,
  key: string,
  config: ResolvedConfig,
  req: PayloadRequest,
): Promise<null | { next: number }> => {
  const result = await payload.find({
    collection: config.countersSlug,
    depth: 0,
    limit: 1,
    overrideAccess: true,
    pagination: false,
    req,
    where: { key: { equals: key } },
  })

  const doc = result.docs[0] as undefined | { next?: unknown }

  if (!doc) {
    return null
  }

  const next = toMinorUnits(doc.next)

  return next === null ? null : { next }
}

const startCounter = async (
  payload: Payload,
  parts: { key: string; series: string; year: number },
  config: ResolvedConfig,
  req: PayloadRequest,
): Promise<void> => {
  try {
    await payload.create({
      collection: config.countersSlug,
      data: { key: parts.key, next: config.startAt, series: parts.series, year: parts.year },
      depth: 0,
      overrideAccess: true,
      req,
    })
  } catch {
    return
  }
}

/**
 * Claims the next value of a series inside the caller's own transaction, so a
 * document that is never written gives its number back with the rollback and
 * the series stays gapless. The claim is a compare and set: the counter only
 * moves when it still holds the value that was read.
 */
export const claimSequence = async (
  payload: Payload,
  parts: { series: string; year: number },
  config: ResolvedConfig,
  req: PayloadRequest,
): Promise<number> => {
  const key = counterKey(parts.series, parts.year)

  for (let attempt = 0; attempt < config.attempts; attempt += 1) {
    const counter = await readCounter(payload, key, config, req)

    if (counter === null) {
      await startCounter(payload, { ...parts, key }, config, req)
      continue
    }

    const current = Math.max(counter.next, config.startAt)
    const result = await payload.update({
      collection: config.countersSlug,
      data: { next: current + 1 },
      depth: 0,
      overrideAccess: true,
      req,
      where: { and: [{ key: { equals: key } }, { next: { equals: counter.next } }] },
    })

    if (result.docs.length === 1) {
      return current
    }
  }

  throw new InvoiceError(
    refusalCodes.NumberUnavailable,
    `No sequence value became free for ${parts.series} ${parts.year} after ${config.attempts} attempts.`,
    { series: parts.series, year: parts.year },
  )
}

/**
 * Hands a claimed value back, for the case where the surrounding write failed
 * and no transaction is there to roll the counter back. It only succeeds when
 * nothing else has claimed a value since, so it can never reuse a number that
 * is already printed.
 */
export const releaseSequence = async (
  payload: Payload,
  parts: { sequence: number; series: string; year: number },
  config: ResolvedConfig,
  req: PayloadRequest,
): Promise<boolean> => {
  const key = counterKey(parts.series, parts.year)
  const result = await payload.update({
    collection: config.countersSlug,
    data: { next: parts.sequence },
    depth: 0,
    overrideAccess: true,
    req,
    where: { and: [{ key: { equals: key } }, { next: { equals: parts.sequence + 1 } }] },
  })

  return result.docs.length === 1
}
