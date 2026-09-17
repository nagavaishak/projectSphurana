# The unified list page

Every list/table screen in the dashboard renders from one component. A feature
supplies **columns and rows**; everything else is shared:

- page header and title
- search box, toolbar slot, primary action (full label on desktop, short on mobile)
- desktop table
- **mobile list, from the same columns**
- loading, error and empty states

Sibling of `components/app/entity-editor`. Lists and editors are the two shapes
nearly every dashboard page takes, and both are now config over shared chrome.

## Usage

```tsx
<ListPage<Membership>
  config={{
    title: 'Memberships',
    searchPlaceholder: 'Search memberships',
    search,
    onSearchChange: setSearch,
    primaryAction: { label: 'Add Membership', mobileLabel: 'Add', onClick: openCreate },
    rows: memberships,
    rowKey: (m) => m.id,
    onRowClick: (m) => navigate({ to: '/edit/$entity/$id', params: { entity: 'membership', id: m.id } }),
    rowActions: (m) => <MembershipRowMenu membership={m} />,
    isLoading,
    empty: { icon: TicketIcon, title: 'No memberships yet',
             description: 'Create one to start selling packages.' },
    columns: [
      { id: 'name',     header: 'Name',     mobile: 'primary',   cell: (m) => m.name },
      { id: 'price',    header: 'Price',    mobile: 'secondary', cell: (m) => formatMoney(m.priceCents) },
      { id: 'services', header: 'Services',                      cell: (m) => <ServiceChips ids={m.serviceIds} /> },
      { id: 'duration', header: 'Duration', mobile: 'trailing',  cell: (m) => `${m.minutes} min` },
    ],
  }}
/>
```

## The mobile roles

A phone cannot show six columns, so each column declares how it appears there:

| `mobile` | Renders as |
|---|---|
| `media` | leading thumbnail (Products) |
| `primary` | the row's title |
| `secondary` | muted line under the title (a price, a code) |
| `trailing` | the one value that matters, right-aligned (Duration, Quantity) |
| *omitted* | desktop only — the phone drops it |

**This is the load-bearing idea.** Today every mobile-ified list has a
hand-written `mobile-record-list` variant sitting beside its table, and the two
drift: a column added to the table silently never reaches the phone. One config
rendered twice removes the possibility.

Declare roles deliberately. If a list has no obvious `trailing` value, leave it
out rather than promoting something arbitrary — a phone row with three competing
numbers is worse than one with a title.

## The phone shell

A phone is a different shell, not a narrower one — and the shell owns all of it,
so no page has to remember any of this:

| | Desktop | Phone |
|---|---|---|
| Title | 24px `<h1>` in the page | compact centred title in the floating header |
| Way back | the sidebar | back control on the header's leading edge |
| Root chrome | — | branch chip / inbox / bell / avatar are **hidden** |
| Search | rounded-full `Input` | `MobileSearchField` (house filter chrome) |
| Create | labelled button (split when `menu`) | round black `+`; with a `menu` it opens the menu |
| `filters` | above the search row | below it — the screen opens with search |
| Rows | `<Table>` | one rounded white card, hairline dividers, chevron |
| Empty | shadcn `Empty` | `MobileRecordListEmpty` (needs `empty.icon`) |

This all comes from `DashboardPage`, so a non-list page built on the same shell
gets the identical phone chrome. Before it did, a shell page on a phone kept the
ROOT-screen header — branch chip, inbox, bell, avatar, no way back — on a screen
the user had navigated into, and then repeated the desktop `<h1>` beneath it,
while Services one tap away showed the drill-down chrome. Two shells for the same
kind of screen.

A page that genuinely IS a bottom-tab root passes `mobileHeader={false}` to
`DashboardPage`; anything else it needs to change goes through the same prop.

## One tree, chosen by viewport

Exactly one of the table and the phone list renders (`useIsMobile`), unlike the
editor, which is CSS-responsive. The editor has form state that must not be
duplicated; a list does not, and rendering both would put every row in the DOM
twice — wasteful on a long list, and it makes every test match each row twice.

The anti-drift property does not come from rendering both at once. It comes from
both rendering from the SAME `columns` config.

## Sorting and pagination

Both are **the caller's job**; the shell renders the controls.

- `ListColumn.sortable` turns a header into a sort button. The shell reports the
  click through `onSortChange` and draws the indicator from `sort` — it does not
  reorder `rows`. Most of these lists sort server-side, and a shell that quietly
  re-ordered one page of a paged result would show you a lie.
- `ListPagination` (exported from here) goes in the `footer` slot. It is
  presentational: the page owns `pageIndex`/`pageSize` and refetches. It exists
  because two migrated lists had already hand-rolled the same row of buttons.

## Slots, in order

| Slot | Where | For |
|---|---|---|
| `description` | under the title | one line of context |
| `filters` | full-width row above search | tab strips, segmented filters, stat cards |
| `toolbar` | inside the search row | sort menus, filter buttons, imports |
| `footer` | below the rows | `ListPagination`, totals, "showing X of Y" |

`toolbar` does not wrap, so anything wide belongs in `filters`.

## Rules

1. **Filtering, sorting and pagination belong to the caller.** `rows` is what
   gets rendered; `search` is a controlled value the caller acts on. The shell
   does not silently filter, because every list's notion of "matches" differs
   (a code, a supplier name, a SKU) and hiding that in shared code makes it
   unfindable.
2. **`rowActions` cells stop propagation** already — do not re-handle it.
3. **Row click should go somewhere real.** With the unified editor, that is
   almost always `/edit/:entity/:id`.
4. **Do not fork this component.** If a list genuinely cannot be expressed, say
   so rather than special-casing — the fork is how twelve tables happened.
