# Data handling & privacy

What's stored, who can access it, and how it's protected — written
plainly enough to hand to a school that asks.

## What KAAN stores about a student

- Full name, roll number, section
- A random QR token (not derived from anything personal, not their
  real database ID)
- Attendance history: date, status (present/absent/medical), and
  which device/session recorded it

**What KAAN does *not* store**: no health data, no financial data,
no government ID numbers, no photos, no contact details (phone/
address) unless a school explicitly adds that later as a feature.

## Who can see what

Enforced by database-level Row-Level Security (RLS) — not just
application code, so even a bug in the app can't accidentally leak
data across schools:

| Role | Can see |
|---|---|
| `exam_cell_staff` | Their own school's students, sections, and attendance — day-to-day kiosk operation |
| `school_admin` | Same as above, plus can add/edit students and sections, and see the scan audit log |
| `platform_admin` | Cross-school access, for support/debugging only |

A school's data is **never visible to another school**. This isn't a
convention the app follows — it's enforced by Postgres itself on
every query, regardless of which part of the app is asking.

## Retention & deletion

- A student who leaves the school gets marked `active = false`
  (soft delete) — their historical attendance record is preserved
  (schools often need this for academic records), but they stop
  appearing in rosters, kiosks, and new attendance sessions.
- **Hard deletion on request**: if a school or a parent requests a
  student's data be permanently erased, this is currently a manual
  database operation (contact the platform admin). A self-serve
  "permanently delete" option is not yet built.
- No automatic purge of old attendance records exists yet. Given the
  data volume involved (a few thousand rows per school per year),
  this isn't an urgent technical need — it's a policy decision for
  whenever a school explicitly asks how long records are kept.

## Security measures in place

- All traffic over HTTPS (enforced by Vercel/Supabase)
- Passwords never touch KAAN's own code — authentication is handled
  entirely by Supabase Auth
- Row-Level Security on every table, enforced at the database layer
- Every scan attempt (successful or not) is logged with who, when,
  and from what IP/device — visible to school admins
- QR tokens are random and unguessable (not sequential, not derived
  from roll number or name)

## What's deliberately not done (yet), and why

- **Application-level field encryption** (encrypting `full_name` in
  the database) was considered and skipped for now — these are
  low-sensitivity fields already displayed in plaintext throughout
  the app and printed on physical ID cards, so encrypting the column
  would add real complexity without meaningfully changing the actual
  risk, which is access control (RLS), not database-dump exposure.
- **SOC 2 Type II certification** — a real, multi-month, expensive
  audit process. Worth pursuing if/when a large institutional
  customer specifically requires it as a condition of purchase, not
  before then.
