import type { CollectionConfig, Field } from 'payload'

import { InvoiceError, refusalCodes } from './errors.js'
import { partyFields } from './config.js'
import { pdfEndpoint } from './endpoints.js'
import type { ResolvedConfig } from './types.js'

const never = (): boolean => false

const sealed = (field: Field): Field => {
  if (!('name' in field)) {
    return field
  }

  const access = 'access' in field && field.access ? field.access : {}

  return { ...field, access: { ...access, update: never } } as Field
}

const labelFor = (name: string): string => {
  const words = name.replace(/([A-Z])/g, ' $1').trim()

  return `${words.charAt(0).toUpperCase()}${words.slice(1).toLowerCase()}`
}

export const partyGroup = (name: string, label: string): Field => ({
  name,
  type: 'group',
  fields: partyFields.map((field) => ({
    name: field,
    type: 'text' as const,
    label: labelFor(field),
  })),
  label,
})

export const lineFields = (): Field[] => [
  {
    name: 'description',
    type: 'text',
    label: 'Description',
    required: true,
  },
  {
    name: 'sku',
    type: 'text',
    label: 'SKU',
  },
  {
    name: 'quantity',
    type: 'number',
    defaultValue: 1,
    label: 'Quantity',
  },
  {
    name: 'unitPrice',
    type: 'number',
    label: 'Unit price',
  },
  {
    name: 'lineTotal',
    type: 'number',
    label: 'Line total',
  },
  {
    name: 'product',
    type: 'text',
    label: 'Product',
  },
  {
    name: 'variant',
    type: 'text',
    label: 'Variant',
  },
]

export const invoiceFields = (config: ResolvedConfig): Field[] => {
  const refund: Field =
    config.refundsSlug.length > 0
      ? {
          name: 'refund',
          type: 'relationship',
          label: 'Refund',
          relationTo: config.refundsSlug,
        }
      : {
          name: 'refund',
          type: 'text',
          label: 'Refund',
        }

  const fields: Field[] = [
    {
      name: 'number',
      type: 'text',
      admin: {
        position: 'sidebar',
        readOnly: true,
      },
      index: true,
      label: 'Number',
      required: true,
      unique: true,
    },
    {
      name: 'kind',
      type: 'select',
      admin: {
        position: 'sidebar',
      },
      defaultValue: 'invoice',
      index: true,
      label: 'Kind',
      options: [
        { label: 'Invoice', value: 'invoice' },
        { label: 'Credit note', value: 'credit-note' },
      ],
      required: true,
    },
    {
      name: 'series',
      type: 'text',
      admin: {
        position: 'sidebar',
      },
      index: true,
      label: 'Series',
      required: true,
    },
    {
      name: 'year',
      type: 'number',
      admin: {
        position: 'sidebar',
      },
      index: true,
      label: 'Year',
      required: true,
    },
    {
      name: 'sequence',
      type: 'number',
      admin: {
        position: 'sidebar',
      },
      index: true,
      label: 'Sequence',
      required: true,
    },
    {
      name: 'issuedAt',
      type: 'date',
      index: true,
      label: 'Issued at',
      required: true,
    },
    {
      name: 'dueAt',
      type: 'date',
      label: 'Due at',
    },
    {
      name: 'order',
      type: 'relationship',
      index: true,
      label: 'Order',
      relationTo: config.ordersSlug,
    },
    {
      name: 'orderReference',
      type: 'text',
      label: 'Order reference',
    },
    {
      name: 'creditedInvoice',
      type: 'relationship',
      index: true,
      label: 'Credit of',
      relationTo: config.invoicesSlug,
    },
    {
      name: 'creditedNumber',
      type: 'text',
      label: 'Credit of number',
    },
    refund,
    partyGroup('seller', 'Seller'),
    partyGroup('buyer', 'Buyer'),
    {
      name: 'lines',
      type: 'array',
      fields: lineFields(),
      label: 'Lines',
      labels: {
        plural: 'Lines',
        singular: 'Line',
      },
    },
    {
      name: 'currency',
      type: 'text',
      label: 'Currency',
    },
    {
      name: 'decimals',
      type: 'number',
      defaultValue: 2,
      label: 'Minor unit digits',
    },
    {
      name: 'net',
      type: 'number',
      label: 'Net',
    },
    {
      name: 'taxRate',
      type: 'number',
      label: 'Tax rate',
    },
    {
      name: 'tax',
      type: 'number',
      label: 'Tax',
    },
    {
      name: 'total',
      type: 'number',
      label: 'Total',
      required: true,
    },
    {
      name: 'notes',
      type: 'textarea',
      label: 'Notes',
    },
    {
      name: 'footer',
      type: 'textarea',
      label: 'Footer',
    },
    {
      name: 'voidedAt',
      type: 'date',
      access: {
        create: never,
      },
      admin: {
        readOnly: true,
      },
      label: 'Voided at',
    },
    {
      name: 'voidReason',
      type: 'text',
      access: {
        create: never,
      },
      admin: {
        readOnly: true,
      },
      label: 'Void reason',
    },
  ]

  return fields.map(sealed)
}

export const invoicesCollection = (config: ResolvedConfig): CollectionConfig => ({
  slug: config.invoicesSlug,
  access: {
    create: config.createAccess,
    delete: never,
    read: config.readAccess,
    update: never,
  },
  admin: {
    defaultColumns: ['number', 'kind', 'issuedAt', 'total', 'currency'],
    description: 'Issued invoices and credit notes. Documents are never edited or removed.',
    group: 'Ecommerce',
    useAsTitle: 'number',
  },
  endpoints: [pdfEndpoint(config)],
  fields: invoiceFields(config),
  hooks: {
    beforeChange: [
      ({ operation }) => {
        if (operation !== 'create') {
          throw new InvoiceError(
            refusalCodes.Immutable,
            'An issued document cannot be changed. Correct it with a credit note.',
          )
        }

        return undefined
      },
    ],
  },
  labels: {
    plural: 'Invoices',
    singular: 'Invoice',
  },
  timestamps: true,
})
