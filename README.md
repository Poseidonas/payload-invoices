# payload-invoices

[![npm](https://img.shields.io/npm/v/payload-invoices?style=flat-square&color=0F766E)](https://www.npmjs.com/package/payload-invoices) ![node](https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square) ![license](https://img.shields.io/badge/license-MIT-6C757D?style=flat-square) ![payload](https://img.shields.io/badge/Payload-3.88+-0a0c0b?style=flat-square)

Issues numbered invoices and credit notes for Payload orders: a gapless sequence per series and year, a frozen snapshot that a later price change cannot touch, and a PDF written without a single runtime dependency.

- Extends `@payloadcms/plugin-ecommerce` and works on any collection that holds orders
- The number is claimed inside the same transaction that writes the document, so a document that is never written leaves no gap
- Every amount is a whole number of minor units, added with integers from beginning to end
- No runtime dependencies, and no runtime import of `payload` either. The PDF encoder is about 200 lines and is part of this package
- No admin components, so it survives minor releases

## Install

Requires **Payload 3.88 or newer** and **`@payloadcms/plugin-ecommerce` 3.88 or newer**. Verified against Payload 3.88.0 with the official plugin installed.

```bash
pnpm add payload-invoices
```

```ts
import { ecommercePlugin } from '@payloadcms/plugin-ecommerce'
import { invoicesPlugin } from 'payload-invoices'

export default buildConfig({
  plugins: [
    ecommercePlugin({ /* ... */ }),
    invoicesPlugin({
      seller: {
        name: 'My Shop',
        addressLine1: 'Main 1',
        city: 'Thessaloniki',
        postalCode: '54622',
        country: 'GR',
        vatNumber: 'EL999999999',
      },
      taxRate: 24,
      series: 'INV',
    }),
  ],
})
```

`invoicesPlugin` must come **after** the plugin that defines the orders collection. It extends what it finds; if the orders collection is not there yet, it returns the config untouched.

An invoice is issued by calling a function, not by writing a document:

```ts
import { issueInvoice } from 'payload-invoices'

const invoice = await issueInvoice(payload, { order: orderID, req })
```

and its PDF is at `GET /api/invoices/:id/pdf`.

## What was measured

Read in the published `@payloadcms/plugin-ecommerce@3.88.0`, in the original TypeScript carried by its source maps.

### There is no invoicing at all

The word does not appear in the plugin. There is no invoice collection, no number, no document, no PDF and no company details anywhere. In the European Union a shop that sells to a consumer owes them a document; nothing in the official plugin produces one.

### What an order can tell an invoice, and what it cannot

| Invoice field | Where it comes from | Present in a stock install |
| --- | --- | --- |
| Total | order `amount` | yes, minor units, written from the payment intent |
| Currency | order `currency` | yes, upper case |
| Lines | order `items` | product, variant and quantity only |
| Line price | nowhere on the order | **no**, see below |
| Buyer address | transaction `billingAddress`, else order `shippingAddress` | see below |
| Buyer email | order `customerEmail`, else the customer document | see below |
| Buyer VAT number | nowhere in the plugin | **no**, read from a field on the customer |
| Seller | nowhere in the plugin | **no**, from this plugin's configuration |
| Tax | nowhere in the plugin | **no**, from a rate you configure |

**An order line has no price.** `fields/cartItemsField.ts` adds an `amount` to a line only when `individualPrices` is passed, and a `currency` only when a currency configuration is passed. `collections/orders/createOrdersCollection.ts` passes neither. A line therefore holds `product`, an optional `variant`, and `quantity`. The only money on an order is `amount` and `currency` at the top.

So the default line resolver reads the price of each product or variant in the order's currency, from the `priceIn<CODE>` field the plugin stores it in, **at the moment the invoice is issued**, and freezes it. That is the best that can be done from a stock install, and it is why the reconciliation below exists.

**The order has no billing address, the transaction does.** `collections/orders/createOrdersCollection.ts` builds a `shippingAddress` group and nothing else. `collections/transactions/createTransactionsCollection.ts` builds a `billingAddress` group, filled by the Stripe adapter from `data.billingAddress` on the checkout call. This plugin reads the billing address of the order's transactions first and falls back to the shipping address, which is what `buyerAddressSource: 'billing'` means.

**A signed in customer's order carries no email.** `payments/adapters/stripe/confirmOrder.ts` writes `...req.user ? { customer: req.user.id } : { customerEmail }`. One or the other, never both. The buyer's email is therefore read from `customerEmail` when there is one and from the customer document when there is not.

**Amounts are integers of minor units.** `ui/utilities.ts` converts a typed price with `Math.round(value * 10 ** currency.decimals)`, and `currencies/index.ts` gives EUR, USD and GBP `decimals: 2`. This package adds, splits and stores integers only, and refuses a fractional amount rather than rounding it.

### Tests

232 unit tests, `pnpm test`. The numbering is tested for gaplessness over five hundred consecutive claims, across series, across years, under a lost compare and set, and after a failed write. The tax split is checked at every gross value from 0 to 2000 and at fourteen real European rates, with `net + tax === total` asserted every time. The PDF output is checked byte by byte: header, every cross reference offset, the twenty byte entry width, the declared stream length and the trailer.

The generated PDF was also checked with `qpdf --check`, which reports no syntax or stream encoding errors, and read back with `pdftotext`, which returns the text in the right order.

## The gapless guarantee, and where it ends

An order number may have gaps. An invoice number may not, and that is the whole difficulty.

`payload-order-numbers` claims a number by inserting it into a reservations collection **in its own transaction**, so the claim is visible to everyone immediately. That produces gaps by design: a claimed number whose order then fails to save is never reused.

This package does the opposite. It keeps one counter document per series and year and claims the next value with a **compare and set inside the caller's own transaction**:

```
read  next = 41 for INV:2026
write next = 42  where key = 'INV:2026' and next = 41
```

If the write matches one document, 41 is yours. If it matches none, someone else moved the counter first, so the counter is read again and the claim is retried. Because the claim and the document are written in the same transaction, a rollback takes the counter back with it.

That gives:

| Situation | Result |
| --- | --- |
| Two invoices at once, PostgreSQL | the second blocks on the counter row, retries, and gets the next value |
| The document fails to save | the transaction rolls back and the number is not consumed |
| The document fails to save with no transaction | the counter is handed back, but only if nothing has claimed a value since |
| A number is written twice | refused by the unique index on `number`, which is the final guarantee |

The first row is how PostgreSQL behaves with a row level lock under read committed isolation, which is Payload's default. It is the one line of this table that has not been measured against a live database, only reasoned from the mechanism; everything else is covered by the tests.

**Where the guarantee ends, stated plainly:**

- **It only covers documents this package writes.** The invoices collection is closed to create through the API by default, and closed to update and delete for everyone. If you open `createAccess` and write invoices by hand, the sequence is yours to keep contiguous.
- **It needs a transaction to be gapless on failure.** Payload runs every request in one on PostgreSQL and on MongoDB with a replica set. On a standalone MongoDB, or with `disableTransaction`, a failed write falls back to handing the number back, which succeeds only when no other document claimed one in between. That window is small and it is a window.
- **Deleting an invoice makes a gap and nothing can prevent it.** Delete is closed through the API. A `DELETE` straight against the database, or a `payload.db` call, is outside anything this package can see.
- **Voiding is not deleting.** A document issued in error stays, and is corrected with a credit note. That is also what a tax authority expects.
- **Concurrency on MongoDB is refusal, not a gap.** MongoDB aborts a transaction on a write conflict rather than blocking, so two invoices issued in the very same instant can end with one request failing. Retry the request; the sequence stays contiguous.
- **The counter is a document.** Editing it by hand, or restoring a database backup taken between the counter write and the invoice write, breaks the sequence. Nothing in software can protect against a restore that splits one transaction.

## Credit notes

A credit note is a document of the same collection with `kind: 'credit-note'`, its own number, and a relationship to the invoice it credits.

```ts
import { issueCreditNote } from 'payload-invoices'

const note = await issueCreditNote(payload, { invoice: invoiceID, amount: 2500, req })
```

**They get their own series by default**, `CN`, so the invoice sequence is obviously contiguous when someone counts it, and a credit note cannot make an invoice number look missing. Setting `creditNoteSeries` to the same value as `series` puts both in one sequence, which some accountants prefer and some jurisdictions require. Both are gapless; pick the one your accountant asks for before you issue the first document, because the series is part of the number.

A credit note never exceeds the part of the invoice that has not been credited already, counting every credit note issued against it. Its amounts are positive; the `kind` says the direction. It copies the seller and the buyer from the invoice it credits rather than reading them again, so a customer who has since moved house still sees the address that was invoiced.

With `payload-refunds` installed, pass `refundsSlug: 'refunds'` and the `refund` field becomes a relationship to that collection instead of plain text. **This package does not depend on it**, at runtime or otherwise, and works with any refund record or none.

## The PDF

`GET /api/invoices/:id/pdf` returns `application/pdf`, rendered from the frozen document alone, so the same invoice always produces the same bytes. The default renderer writes a single A4 page: seller, buyer, the number and the dates, a table of lines, net, tax and total, then your notes and footer.

It is written by hand in this package: PDF 1.4, uncompressed content streams, the base fourteen fonts declared with WinAnsi encoding. That is why there is no dependency, and it is also the limit. A character outside WinAnsi, Greek or Cyrillic for instance, is printed as `?`, because printing anything else would mean embedding a font, and embedding a font means a dependency or a large amount of code with a different purpose.

If that matters to you, supply your own renderer and the endpoint uses it:

```ts
invoicesPlugin({
  renderer: async ({ invoice, decimals }) => myPdfLibrary(invoice, decimals),
})
```

The pieces are exported so you can build on them rather than start over: `encodePdf`, `renderInvoice`, `winAnsi`, `escapeString`, `formatAmount`.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `adjustmentLabel` | `'Adjustment'` | Label of the line added when the lines do not add up to the amount charged |
| `attempts` | `20` | How many times a number is claimed before giving up |
| `autoIssueOnStatus` | `[]` | Order statuses that issue an invoice automatically when an order enters them |
| `buyerAddressSource` | `'billing'` | `'billing'` reads the transaction's billing address and falls back to shipping; `'shipping'` reads shipping only |
| `buyerVatFieldName` | `'vatNumber'` | Field on the customer document holding their VAT number |
| `countersSlug` | `'invoice-counters'` | Collection holding one counter per series and year |
| `createAccess` | refuses everyone | Who may create an invoice through the API |
| `creditNoteSeries` | `'CN'` | Series used for credit notes |
| `customersSlug` | `'users'` | Collection the customers live in |
| `decimals` | `{ EUR: 2, GBP: 2, USD: 2 }` | Minor unit digits per currency code |
| `defaultDecimals` | `2` | Digits for a currency not listed above |
| `disabled` | `false` | Stops the automatic issuing hook but keeps every field and collection |
| `footer` | `''` | Text printed at the bottom of every document |
| `invoicesSlug` | `'invoices'` | Slug of the invoices collection |
| `numberFormat` | `SERIES-YEAR-00001` | Builds the printed number from `{ sequence, series, year }` |
| `onLineMismatch` | `'adjust'` | `'adjust'` adds one labelled line for the difference, `'refuse'` throws |
| `ordersSlug` | `'orders'` | Slug of the orders collection |
| `padding` | `5` | Width of the numeric part, left padded with zeros |
| `productsSlug` | `'products'` | Slug of the products collection |
| `readAccess` | any signed in user | Who may read invoices |
| `refundsSlug` | `''` | Given a value, the `refund` field becomes a relationship to it |
| `renderer` | built in | Turns the frozen document into PDF bytes |
| `resetYearly` | `true` | Starts a new sequence each calendar year, by UTC |
| `resolveLines` | reads product prices | Builds the lines of an invoice from the order |
| `seller` | none | Your details. `name` is required before anything can be issued |
| `series` | `'INV'` | Series used for invoices |
| `startAt` | `1` | Value given to the first document of a series |
| `taxRate` | `0` | Percentage used to split the amount charged into net and tax |
| `transactionsSlug` | `'transactions'` | Collection read for the billing address |
| `variantsSlug` | `'variants'` | Slug of the variants collection |

A value that cannot be used is replaced by its default rather than being applied. A slug given as an empty string becomes its default, a `startAt` of `0` or `-5` becomes `1`, `4.9` becomes `4`, and a negative `taxRate` becomes `0`. Nothing is silently reinterpreted: `-5` never becomes `5`. A `padding` of `0` is kept, because padding nothing is a real choice.

### Where each field on the document comes from

| Field | Source | When it is missing |
| --- | --- | --- |
| `seller.*` | the `seller` option, or the `seller` argument of `issueInvoice` | `name` missing refuses the invoice with `NoSeller`; every other field is simply not printed |
| `buyer.name` | billing or shipping address: `company`, else `firstName lastName`; else the customer's `name` | not printed |
| `buyer` address | billing address of the order's transactions, else the order's `shippingAddress` | not printed |
| `buyer.email` | order `customerEmail`, else the customer document's `email` | not printed |
| `buyer.vatNumber` | the customer document's `vatNumber`, or `buyerVatFieldName` | not printed. Pass `buyer` to `issueInvoice` to supply it |
| `lines` | `resolveLines`, or each product and variant's `priceIn<CODE>` | a product with no price in that currency prices at zero, and the whole difference lands in the adjustment line |
| `total` | the order's `amount` | an order amount that is not whole minor units refuses the invoice with `InvalidAmount` |
| `net`, `tax` | the total split at `taxRate` | at rate zero the whole total is net |
| `currency` | the order's `currency` | empty, and the minor unit digits fall back to `defaultDecimals` |

Nothing is guessed. A field this package cannot find is left empty and left off the page, and the two that make a document meaningless, the seller's name and a whole total, refuse the invoice instead.

### How the lines are made to add up

The total of an invoice is always the order's `amount`, because that is the money that changed hands. The lines are built separately, so they may not add up to it: shipping, a discount, a coupon, or a product whose price changed since the order was placed.

No line is ever altered to close that gap. Instead one extra line is added, carrying the difference and labelled by `adjustmentLabel`, so the arithmetic on the page is right and the reason is visible. Set `onLineMismatch: 'refuse'` to have the invoice refused instead, and supply exact lines yourself:

```ts
await issueInvoice(payload, {
  order: orderID,
  lines: [{ description: 'Widget, large', quantity: 2, unitPrice: 2000, lineTotal: 4000 }],
  req,
})
```

## What it adds to your database

| Collection | Field | Type | Notes |
| --- | --- | --- | --- |
| `invoices` | `number` | text | **unique**, indexed, the final guarantee |
| `invoices` | `kind` | select | `invoice` or `credit-note`, indexed |
| `invoices` | `series`, `year`, `sequence` | text, number, number | all indexed, the parts the number is built from |
| `invoices` | `issuedAt`, `dueAt` | date | `issuedAt` indexed and required |
| `invoices` | `order`, `orderReference` | relationship, text | the reference survives a deleted order |
| `invoices` | `creditedInvoice`, `creditedNumber` | relationship, text | credit notes only |
| `invoices` | `refund` | text or relationship | relationship when `refundsSlug` is set |
| `invoices` | `seller`, `buyer` | group | name, address, email, phone, VAT, tax number, registration |
| `invoices` | `lines` | array | `description`, `sku`, `quantity`, `unitPrice`, `lineTotal`, `product`, `variant` |
| `invoices` | `currency`, `decimals` | text, number | the digits are frozen with the document |
| `invoices` | `net`, `tax`, `taxRate`, `total` | number | minor units, except the rate |
| `invoices` | `notes`, `footer` | textarea | printed at the bottom |
| `invoices` | `voidedAt`, `voidReason` | date, text | closed to the API |
| `invoice-counters` | `key`, `series`, `year`, `next` | text, text, number, number | `key` unique and indexed. Collection hidden, no API access |

Nothing is added to your orders, products, variants or transactions. The invoices collection is closed to update and delete, **every field is closed to update**, and update is refused a second time inside the collection's own `beforeChange` hook, which catches a Local API call that overrides access. The counters collection is closed to create, read, update and delete through the API and hidden in the admin panel.

## What it adds to your API and your code

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/invoices/:id/pdf` | get | The document as a PDF, subject to the collection's read access |

```ts
import { issueInvoice, issueCreditNote, InvoiceError, refusalCodes } from 'payload-invoices'

try {
  await issueInvoice(payload, { order: orderID, req, dueAt: '2026-09-18' })
} catch (error) {
  if (error instanceof InvoiceError && error.code === refusalCodes.AlreadyIssued) {
    // this order already carries an invoice
  }
}
```

Every refusal is an `InvoiceError` carrying HTTP 400, `isPublic`, and a code from `refusalCodes`: `AlreadyIssued`, `InvalidAmount`, `InvoiceImmutable`, `InvoiceNotFound`, `NoSeller`, `NumberUnavailable`, `OrderNotFound`, `OverCredited`, `TotalMismatch`.

Also exported, for building on rather than around: `claimSequence`, `releaseSequence`, `formatNumber`, `counterKey`, `splitTax`, `formatAmount`, `reconcile`, `decimalsFor`, `partyFromAddress`, `buyerFor`, `defaultResolveLines`, `renderInvoice`, `encodePdf`.

## Honest limits

**This package does not know your law, and neither does its author.** It produces a numbered, sequential, frozen document with the fields most European invoices need. Whether that document satisfies your tax authority, whether you owe one at all, what it must say, how long you must keep it, and whether your rate is right, are yours to answer. Nothing here is legal or accounting advice. Check what you issue with an accountant in your own country before you send the first one.

**One rate for the whole invoice.** `taxRate` splits the total; there is no rate per line, no reverse charge, no exemption and no OSS. A shop selling at two rates on one order cannot express that here. That is a different package, and `payload-tax-eu` in this kit is where it belongs.

**A line price is read when the invoice is issued, not when the order was placed.** The order does not store it, as measured above. If a product's price changed between the sale and the invoice, the lines use the new price and the difference lands in the adjustment line, with the total still exactly what was charged. Issue invoices close to the sale, or pass `lines` yourself from your own snapshot.

**The invoice freezes; the relationships do not.** The seller, the buyer, every line and every amount are copied into the document and never read again. The `order` and `creditedInvoice` relationships still point outwards, and a deleted order leaves them dangling, which is why `orderReference` and `creditedNumber` keep plain text copies.

**A document cannot be edited, on purpose.** There is no correction, no re-issue and no regeneration. A mistake is corrected with a credit note and a new invoice. `voidedAt` and `voidReason` exist on the document and are closed to the API; nothing in this package writes them yet.

**Automatic issuing never stops an order from saving.** With `autoIssueOnStatus`, the hook runs after the order is written and any failure is logged rather than thrown, because an order that cannot be saved is worse than an invoice that has to be issued by hand. Check your server log if a document you expected did not appear.

**The PDF is plain, and Latin-1 only.** One A4 page, base fourteen fonts, no logo, no image, no colour, no page break: a long order is cut where the page ends. Descriptions are truncated rather than wrapped, because wrapping needs font metrics this package deliberately does not carry. Supply your own `renderer` for anything more.

**The built-in renderer needs the Node runtime.** It writes bytes through Node's `Buffer`, so a route running on the edge runtime cannot use it. Everything else in the package is plain JavaScript. Supply your own `renderer` if you must render on the edge.

**Nothing is emailed.** The PDF is served from an endpoint and that is all. `payload-order-emails` in this kit is where sending belongs.

**Two invoices for one order are refused by default.** Pass `allowDuplicate: true` if you really want a second one; it gets its own number and both remain.

## License

MIT. Copyright George Vasiliades, https://github.com/Poseidonas
