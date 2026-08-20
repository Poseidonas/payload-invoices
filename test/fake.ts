type Doc = Record<string, unknown>

type Where = Record<string, unknown>

const matchesLeaf = (doc: Doc, field: string, condition: unknown): boolean => {
  if (!condition || typeof condition !== 'object') {
    return false
  }

  const equals = (condition as { equals?: unknown }).equals

  if (equals === undefined) {
    return true
  }

  return String(doc[field] ?? '') === String(equals)
}

export const matches = (doc: Doc, where: Where | undefined): boolean => {
  if (!where) {
    return true
  }

  for (const [field, condition] of Object.entries(where)) {
    if (field === 'and') {
      if (!(condition as Where[]).every((entry) => matches(doc, entry))) {
        return false
      }

      continue
    }

    if (field === 'or') {
      if (!(condition as Where[]).some((entry) => matches(doc, entry))) {
        return false
      }

      continue
    }

    if (!matchesLeaf(doc, field, condition)) {
      return false
    }
  }

  return true
}

export type FakePayload = {
  collections: Record<string, Doc[]>
  create: (args: { collection: string; data: Doc }) => Promise<Doc>
  find: (args: { collection: string; where?: Where }) => Promise<{ docs: Doc[] }>
  findByID: (args: { collection: string; id: number | string }) => Promise<Doc | null>
  logger: { error: (...args: unknown[]) => void }
  update: (args: {
    collection: string
    data: Doc
    id?: number | string
    where?: Where
  }) => Promise<{ docs: Doc[] } | Doc>
  writes: { collection: string; data: Doc; id?: number | string }[]
}

export const fakePayload = (
  collections: Record<string, Doc[]> = {},
  unique: string[] = ['key', 'number'],
): FakePayload => {
  const store: Record<string, Doc[]> = {}

  for (const [slug, docs] of Object.entries(collections)) {
    store[slug] = docs.map((doc) => ({ ...doc }))
  }

  const writes: FakePayload['writes'] = []
  let nextId = 1000

  const payload: FakePayload = {
    collections: store,
    create: ({ collection, data }) => {
      const docs = store[collection] ?? []

      for (const field of unique) {
        if (data[field] !== undefined && docs.some((doc) => doc[field] === data[field])) {
          return Promise.reject(new Error(`duplicate ${field}`))
        }
      }

      const doc = { ...data, id: (nextId += 1) }

      store[collection] = [...docs, doc]

      return Promise.resolve(doc)
    },
    find: ({ collection, where }) =>
      Promise.resolve({ docs: (store[collection] ?? []).filter((doc) => matches(doc, where)) }),
    findByID: ({ collection, id }) =>
      Promise.resolve((store[collection] ?? []).find((doc) => String(doc.id) === String(id)) ?? null),
    logger: { error: () => undefined },
    update: ({ collection, data, id, where }) => {
      const docs = store[collection] ?? []
      const targets =
        id === undefined
          ? docs.filter((doc) => matches(doc, where))
          : docs.filter((doc) => String(doc.id) === String(id))

      for (const doc of targets) {
        Object.assign(doc, data)
        writes.push({ collection, data: { ...data }, id: doc.id as number | string })
      }

      return Promise.resolve(id === undefined ? { docs: targets } : (targets[0] ?? {}))
    },
    writes,
  }

  return payload
}

export const request = (payload: FakePayload, user: Doc | null = { collection: 'users', email: 'shop@example.com', id: 3 }) =>
  ({ payload, user }) as never
