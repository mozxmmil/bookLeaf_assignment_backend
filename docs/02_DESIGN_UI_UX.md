# UI/UX Design – BookLeaf Support Portal

Goal: clean, functional, fast. Not pixel-perfect.

## Design System
| Token | Value |
|---|---|
| UI kit | Tailwind CSS + shadcn/ui |
| Primary | `#2F5D50` (deep green – "leaf") |
| Font | Inter |
| Priority colours | Critical = red, High = orange, Medium = yellow, Low = gray |
| Status colours | Open = blue, In Progress = purple, Resolved = green, Closed = gray |

## Sitemap
```
/login
/author
  /books              My Books
  /tickets            My Tickets
  /tickets/new        New Ticket
  /tickets/:id        Ticket thread
/admin
  /tickets            Ticket Queue
  /tickets/:id        Ticket workspace (AI draft + notes)
```

## Wireframes

### Login
```
┌──────────────────────────────┐
│        🍃 BookLeaf           │
│  Email    [______________]   │
│  Password [______________]   │
│        [   Sign in   ]       │
└──────────────────────────────┘
```

### Author – My Books
```
┌ Sidebar ─┬─────────────────────────────────────────────┐
│ My Books │ Summary: Earned ₹X | Paid ₹Y | Pending ₹Z    │
│ Tickets  │──────────────────────────────────────────────│
│ + New    │ ┌ Book card ───────────────────────────────┐ │
│          │ │ Title           [Published & Live]       │ │
│          │ │ ISBN · Genre · Pub date · MRP ₹299       │ │
│          │ │ Sold 420 | Earned ₹ | Paid ₹ | Pending ₹ │ │
│          │ │ [Raise query about this book]            │ │
│          │ └──────────────────────────────────────────┘ │
│          │ ┌ Book in production ─────────────────────┐ │
│          │ │ Title  [Typesetting]  ●●●●○○○○○ stage bar │ │
│          │ │ Sales & royalty available after launch   │ │
│          │ └──────────────────────────────────────────┘ │
└──────────┴─────────────────────────────────────────────┘
```

### Author – New Ticket
```
Book      [▼ General / Account Level | Book A | Book B]
Subject   [__________________________]
Details   [__________________________]
          [__________________________]
Attach    [ Choose file ] (optional)
          [ Submit ticket ]
```
After submit → redirect to ticket thread, toast "We've received your query".

### Author – Ticket Thread
```
#TK-1023  Royalty not received      [In Progress]
Book: The Silent River · Opened 2 days ago
─────────────────────────────────────────
You:        I haven't received my royalty…
BookLeaf:   Hi Priya, I completely understand…   (live via SSE)
```

### Admin – Ticket Queue
```
Filters: [Status ▼] [Category ▼] [Priority ▼] [Date range] [Assigned to me ☐]
┌──────┬───────────┬──────────────┬──────────┬──────────┬────────┬──────────┐
│ ID   │ Author    │ Subject      │ Category │ Priority │ Status │ Age      │
├──────┼───────────┼──────────────┼──────────┼──────────┼────────┼──────────┤
│ 1023 │ Priya S.  │ No royalty 6m│ Royalty  │ 🔴 Crit  │ Open   │ 3d ⚠     │
│ 1019 │ Rahul K.  │ Wrong ISBN   │ ISBN     │ 🟠 High  │ Open   │ 1d       │
└──────┴───────────┴──────────────┴──────────┴──────────┴────────┴──────────┘
Default sort: priority DESC, created_at ASC. Old unresolved (> 48h) get ⚠.
```

### Admin – Ticket Workspace
```
┌ Left: Conversation ───────────────┬ Right: Context panel ─────────┐
│ Author query                      │ Author: Priya S. (email)      │
│ Previous replies                  │ Book: title, status, royalty  │
│ ┌ AI Draft (editable) ──────────┐ │ Category [Royalty ▼] 🤖 AI    │
│ │ Hi Priya, I understand…       │ │ Priority [Critical ▼] 🤖 AI   │
│ └───────────────────────────────┘ │ Status   [Open ▼]             │
│ [↻ Regenerate] [Send reply]       │ [Assign to me]                │
│                                   │ Internal notes 🔒             │
│ If AI fails: "AI unavailable –    │ [______________] [Add note]   │
│ write manually" + [Retry]         │                               │
└───────────────────────────────────┴───────────────────────────────┘
```

## UX Decisions (Product Thinking)
- Overridden AI fields show "edited by admin" badge → feedback data for future accuracy
- Royalty pending < ₹1,000 shows tooltip: "Rolls over to next quarter (min payout ₹1,000)"
- Ticket form pre-selects a book when opened from a book card
- Empty states everywhere with a clear next action
- Loading skeletons; AI draft shows "Drafting…" spinner, never blocks the page
