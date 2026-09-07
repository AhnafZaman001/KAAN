# KAAN

QR-based attendance for KIPS College (and built to be multi-school
from the start). Each student carries a laminated QR card; a tablet
kiosk at the classroom door reads it as they walk in. Anyone who
doesn't scan by the time the session closes is marked absent
automatically.

## How it works

1. **Print ID cards** (`/dashboard/id-cards`) — generates a PDF of
   QR-coded cards for a section's roster, laid out for laminating.
   Each QR encodes an opaque per-student token (`students.qr_token`),
   not their real database ID — a lost card can be reissued by
   rotating the token without touching their history.
2. **Kiosk** (`/dashboard/kiosk`) — staff logs in on a tablet, picks
   the section meeting there, starts a session. Students scan their
   card via the device camera as they enter; each scan marks them
   present in real time.
3. **Session close** — ending the session marks every active student
   in that section who never scanned as absent by default. Presence
   is earned by scanning; absence is the fallback, not something
   staff has to enter by hand.

## Stack

- **Frontend**: Next.js 14 (App Router), deployed on Vercel
- **Backend**: Supabase (Postgres + Auth + RLS)
- **QR**: `qrcode` (generate) / `jsqr` (decode in-browser) — pure JS,
  no external service needed
- **ID card PDFs**: `pdf-lib`

No separate backend service is needed — everything runs in Next.js
API routes plus Supabase. (An earlier version of this project used
OCR on photographed paper sheets, which needed a separate Python/
OpenCV microservice — that approach was dropped in favor of QR
scanning, which is both faster for students and simpler to run.)

## Repo structure

```
app/
  dashboard/
    id-cards/       — generate & download QR ID card PDFs
    kiosk/          — the live scanning UI
    page.tsx        — student roster view
  api/
    id-cards/generate/   — PDF generation endpoint
    kiosk/session/       — open/resume a scan session
    kiosk/session/close/ — close a session, auto-mark absentees
    kiosk/scan/          — record one QR scan
lib/
  supabase/          — browser + server Supabase clients
supabase/
  migrations/         — schema, RLS policies, in order
  seed.sql            — test school/section/students
```

## Database model

- `schools`, `sections`, `students` — as before, school-agnostic
- `students.qr_token` — unique opaque UUID, the QR payload
- `attendance_sessions` — one row per section per day; `open` while
  scanning, `closed` once ended
- `attendance_records` — one row per student per session;
  `source` is `scan` (student scanned in), `auto_absent` (session
  closed, they never scanned), or `manual` (staff override)
- `attendance_corrections` — append-only audit log of any status
  change after the fact

Run migrations in `supabase/migrations/` in numeric order against a
fresh Supabase project.

## Setup

```bash
cp .env.local.example .env.local
# fill in NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
npm install
npm run dev
```

Run the SQL files under `supabase/migrations/` (in order) and then
`supabase/seed.sql` in your Supabase project's SQL editor to get a
working test school to log in against.
