import { describe, expect, it } from 'vitest'

import { resolveConfig } from '../src/config.js'
import { claimSequence, countersCollection, releaseSequence } from '../src/counters.js'
import { InvoiceError, refusalCodes } from '../src/errors.js'
import { fakePayload, request } from './fake.js'

const config = resolveConfig()

const inv = { series: 'INV', year: 2026 }

const store = () => fakePayload({ 'invoice-counters': [] })

describe('the counters collection', () => {
  const collection = countersCollection(config)

  it('is closed to the API in every direction', () => {
    for (const operation of ['create', 'delete', 'read', 'update'] as const) {
      expect(collection.access?.[operation]?.({} as never)).toBe(false)
    }
  })

  it('is hidden from the admin panel', () => {
    expect(collection.admin?.hidden).toBe(true)
  })

  it('puts a unique index on the key, which is the only real guarantee', () => {
    const key = collection.fields.find((field) => 'name' in field && field.name === 'key')

    expect((key as { unique?: boolean }).unique).toBe(true)
    expect((key as { index?: boolean }).index).toBe(true)
  })

  it('requires every field', () => {
    for (const name of ['key', 'series', 'year', 'next']) {
      const field = collection.fields.find((entry) => 'name' in entry && entry.name === name)

      expect((field as { required?: boolean }).required).toBe(true)
    }
  })
})

describe('claimSequence', () => {
  it('gives the first document the starting value', async () => {
    const payload = store()

    expect(await claimSequence(payload as never, inv, config, request(payload))).toBe(1)
  })

  it('respects a startAt from the options', async () => {
    const payload = store()
    const started = resolveConfig({ startAt: 1000 })

    expect(await claimSequence(payload as never, inv, started, request(payload))).toBe(1000)
  })

  it('hands out a gapless run of five hundred values', async () => {
    const payload = store()
    const req = request(payload)
    const claimed: number[] = []

    for (let index = 0; index < 500; index += 1) {
      claimed.push(await claimSequence(payload as never, inv, config, req))
    }

    expect(claimed).toEqual(Array.from({ length: 500 }, (_, index) => index + 1))
  })

  it('keeps a separate run per series', async () => {
    const payload = store()
    const req = request(payload)

    await claimSequence(payload as never, inv, config, req)
    await claimSequence(payload as never, inv, config, req)

    expect(await claimSequence(payload as never, { series: 'CN', year: 2026 }, config, req)).toBe(1)
    expect(await claimSequence(payload as never, inv, config, req)).toBe(3)
  })

  it('keeps a separate run per year', async () => {
    const payload = store()
    const req = request(payload)

    await claimSequence(payload as never, inv, config, req)

    expect(await claimSequence(payload as never, { series: 'INV', year: 2027 }, config, req)).toBe(1)
  })

  it('creates exactly one counter per series and year', async () => {
    const payload = store()
    const req = request(payload)

    await claimSequence(payload as never, inv, config, req)
    await claimSequence(payload as never, inv, config, req)
    await claimSequence(payload as never, inv, config, req)

    expect(payload.collections['invoice-counters']).toHaveLength(1)
  })

  it('moves the counter on by exactly one each time', async () => {
    const payload = store()
    const req = request(payload)

    await claimSequence(payload as never, inv, config, req)
    await claimSequence(payload as never, inv, config, req)

    expect(payload.collections['invoice-counters']?.[0]?.next).toBe(3)
  })

  it('takes the next value when a second writer moved the counter first', async () => {
    const payload = store()
    const req = request(payload)

    await claimSequence(payload as never, inv, config, req)

    let first = true
    const racing = {
      ...payload,
      update: (args: Parameters<typeof payload.update>[0]) => {
        if (first) {
          first = false
          const counter = payload.collections['invoice-counters']?.[0]

          if (counter) {
            counter.next = (counter.next as number) + 1
          }

          return Promise.resolve({ docs: [] })
        }

        return payload.update(args)
      },
    }

    expect(await claimSequence(racing as never, inv, config, req)).toBe(3)
  })

  it('gives up rather than reusing a value when the counter never settles', async () => {
    const payload = store()
    const stuck = { ...payload, update: () => Promise.resolve({ docs: [] }) }

    await expect(
      claimSequence(stuck as never, inv, resolveConfig({ attempts: 3 }), request(payload)),
    ).rejects.toBeInstanceOf(InvoiceError)
  })

  it('carries the refusal as an HTTP 400 with a code', async () => {
    const payload = store()
    const stuck = { ...payload, update: () => Promise.resolve({ docs: [] }) }

    try {
      await claimSequence(stuck as never, inv, resolveConfig({ attempts: 2 }), request(payload))
    } catch (error) {
      expect((error as InvoiceError).code).toBe(refusalCodes.NumberUnavailable)
      expect((error as InvoiceError).status).toBe(400)
    }
  })

  it('never hands the same value out twice, over a long run', async () => {
    const payload = store()
    const req = request(payload)
    const seen = new Set<number>()

    for (let index = 0; index < 200; index += 1) {
      seen.add(await claimSequence(payload as never, inv, config, req))
    }

    expect(seen.size).toBe(200)
  })
})

describe('releaseSequence', () => {
  it('gives a claimed value back when nothing has moved on', async () => {
    const payload = store()
    const req = request(payload)
    const sequence = await claimSequence(payload as never, inv, config, req)

    expect(await releaseSequence(payload as never, { ...inv, sequence }, config, req)).toBe(true)
    expect(await claimSequence(payload as never, inv, config, req)).toBe(sequence)
  })

  it('refuses to give a value back once another document has taken one', async () => {
    const payload = store()
    const req = request(payload)
    const first = await claimSequence(payload as never, inv, config, req)

    await claimSequence(payload as never, inv, config, req)

    expect(await releaseSequence(payload as never, { ...inv, sequence: first }, config, req)).toBe(
      false,
    )
  })

  it('leaves the counter where it was when it refuses', async () => {
    const payload = store()
    const req = request(payload)

    await claimSequence(payload as never, inv, config, req)
    await claimSequence(payload as never, inv, config, req)
    await releaseSequence(payload as never, { ...inv, sequence: 1 }, config, req)

    expect(payload.collections['invoice-counters']?.[0]?.next).toBe(3)
  })
})
