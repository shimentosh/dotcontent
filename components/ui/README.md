# UI kit

Everything a screen needs twice lives here. Import from the barrel:

```tsx
import { Page, PageHeader, Button, Select, ListPanel } from "@/components/ui";
```

**The rule:** if you are about to write an inline style object for something
that already exists below, use the component instead. If you are about to write
one for something that does *not* exist and the next screen will need it too,
add it here first, then use it. Views should read as content and behaviour, not
as CSS.

The app styles with inline objects (no CSS-in-JS runtime, no utility classes),
so `Hov` supplies hover/active states and `lib/theme.ts` supplies the tokens —
`t()` for text on the dark ground, `w()` for white veils, `font`, `spring`,
`panel()`, `primary`, `ghost`.

## Page shell

| Component | Use it for |
| --- | --- |
| `Page` | The routed screen's container: one max width, one padding, the enter animation. |
| `PageHeader` | Title, one-line blurb, page-level actions on the right. |
| `Toolbar` | The strip under the header: filters left, counts and view toggles right. |
| `Rail` | The narrow column of things you can switch between, beside what you are looking at — the reader's topics, Content's series. One-line rows, a count on the right, an optional filter well. Not a `ListPanel`: a list is a screen's content, a rail is how you get between screensful of it. |
| `TabNav` | The tabs across an area that spans more than one route (Content / Manage series). Which one is lit comes from the path, so it survives a reload and the back button. Not `Segmented` — that picks a view of one list; these are different pages, and showing both in the same shape asks the reader to work out which row navigates. |

## Controls

| Component | Use it for |
| --- | --- |
| `Button` | Every button. `variant`: `primary` (the one action) · `ghost` (default) · `accent` (tinted, secondary) · `quiet` (no chrome until hovered) · `danger`. `size`: `sm` (30px, in rows and toolbars) · `md` (34px, in forms and modals). Pass `icon` / `iconRight`, `full`, `disabled`. |
| `IconButton` | A square button holding one glyph. `label` is required — it becomes the tooltip and the accessible name. Set `stopPropagation` when it sits inside a clickable row. |
| `Select` | Any pick-one-of-many. Never use a native `<select>`: it draws the list with the OS, which lands a white menu in a dark app. Options may carry `group` for headings and `hint` for right-hand text. Arrows/Enter/Escape/Home/End all work. |
| `Segmented` | Tabs, layout toggles, and any other pick-exactly-one. `tone="accent"` when the choice changes what a following action does; the default when it only changes the view. |
| `Toggle` | One setting that is on or off and takes effect on click. `label` is required — a bare switch announces itself as "switch, on" and nothing more. `size="sm"` in a row of chips, `md` in a settings list. For a choice with a third option, use `Segmented`. |
| `SearchInput` | The recessed search well: glyph, clear button, optional key hint (`"/"`, `"⌘K"`). |
| `FilterMenu` | A multi-select filter chip with counts, for faceted lists. |
| `PlaceholderChips` | The row under a prompt box offering `{{series}}`, `{{part_number}}` and the rest. Clicking one inserts it at the cursor through the textarea's own `setRangeText`, so undo still works. Reads its list from `lib/run-inputs.ts` — never spell the keys out at a call site. |
| `Field` / `TextInput` / `TextArea` | Labelled form controls. `Field` carries the label, hint and character counter. `TextArea` takes `boxRef` when a caller needs the element itself (inserting at the caret). |

## Surfaces

| Component | Use it for |
| --- | --- |
| `Modal` | Anything that interrupts: a create form, a confirm. Portalled, Escape and backdrop close it, `footer` holds the actions. |
| `Popover` | A menu anchored to a trigger. Portalled, follows the trigger on scroll and resize, and **carries its own surface** — the frosted panel, border, shadow and pop. Pass `style` only for what genuinely differs (a `zIndex` above a modal, a `maxHeight` for a long list); passing the material again is how seven copies of it drifted apart. |
| `Card` / `CardGrid` | Grid tiles. `highlight` flashes one that just arrived. |
| `Chip` / `RemovableChip` | Status pills and active-filter pills. Use `tone` (`mute` · `accent` · `good` · `warn` · `bad`) unless the value carries its own colour from data, then pass `bg`/`fg`. |

## Lists

Index screens share one table. Pass a single `columns` template to the header
and to every row so nothing can drift:

```tsx
const COLUMNS = "1fr 112px 82px 96px";

<ListPanel>
  <ListHeader columns={COLUMNS} labels={["TOPIC", "STATUS", "UPDATED", ""]} />
  <ListGroup icon={<StackGlyph />} label="AI" meta="3 topics">
    {/* group-level actions go here */}
  </ListGroup>
  <ListRow columns={COLUMNS} onClick={open} highlight={isNew}>
    <ListCell
      icon={<RowTile bg={tone.bg}><TopicGlyph stroke={tone.fg} /></RowTile>}
      title={topic.name}
      subtitle={topic.desc}
    />
    <Chip tone="good">Researched</Chip>
    <ListStat>12</ListStat>
    <IconButton label="Research this" stopPropagation onClick={research}>
      <FindGlyph />
    </IconButton>
  </ListRow>
</ListPanel>
```

`EmptyState` closes the list when there is nothing in it — `compact` for a row
inside a panel, full for a whole screen.

## Icons

Two sets, both inline SVG on a 24px grid, both taking `size` and `stroke`:
`components/ui/Icons.tsx` (app chrome — nav, actions, content types) and
`components/ui/DocIcons.tsx` (the document and list screens). Add new ones to
the matching file in the same line style rather than importing an icon library.

## Adding to the kit

1. It earns a place when a second screen needs it, not before.
2. Props carry intent (`variant`, `tone`, `size`), never raw colour — a caller
   passing `#0057fc` means the token is missing.
3. Anything interactive takes a `label` when it has no visible text.
4. Export it from `index.ts` and give it a row in this file.
