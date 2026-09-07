-- =========================================================
-- KAAN — QR Attendance Model
-- Replaces the OCR/paper-sheet model (sheets, sheet_status,
-- confidence-based attendance_records) with QR scan sessions.
-- Run this AFTER 001, 002, 003.
-- =========================================================

-- ---------------------------------------------------------
-- 1. Give every student a scannable QR token.
-- Deliberately NOT the student's primary key — an opaque token
-- means a lost/damaged card can be reissued (rotate the token)
-- without touching the student's actual record or history.
-- ---------------------------------------------------------
alter table students
  add column qr_token uuid not null default gen_random_uuid(),
  add constraint students_qr_token_unique unique (qr_token);

create index idx_students_qr_token on students(qr_token);

-- ---------------------------------------------------------
-- 2. Drop the old paper-sheet model entirely.
-- Views must go first — they reference attendance_records and
-- would otherwise block the table drop.
-- ---------------------------------------------------------
drop view if exists section_daily_summary;
drop view if exists student_attendance_summary;
drop table if exists attendance_corrections;
drop table if exists attendance_records;
drop table if exists sheets;
drop type if exists sheet_status;
drop type if exists attendance_status;

-- ---------------------------------------------------------
-- 3. ATTENDANCE_SESSIONS
-- One row per section, per day — replaces "sheets". Opened when
-- a kiosk starts scanning for first-lecture attendance, closed
-- at the end (which triggers auto-marking absentees).
-- ---------------------------------------------------------
create type session_status as enum ('open', 'closed');

create table attendance_sessions (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references schools(id) on delete cascade,
  section_id    uuid not null references sections(id) on delete restrict,
  session_date  date not null,
  status        session_status not null default 'open',
  opened_by     uuid,             -- references auth.users, nullable
  opened_at     timestamptz not null default now(),
  closed_by     uuid,
  closed_at     timestamptz,

  unique (section_id, session_date)
);

create index idx_sessions_school_date on attendance_sessions(school_id, session_date);

-- ---------------------------------------------------------
-- 4. ATTENDANCE_RECORDS (redesigned)
-- One row per student per session. 'scan' rows are ground
-- truth (the student physically scanned in) — no confidence
-- score needed, unlike the old OCR model. 'auto_absent' rows
-- get created when a session closes for anyone who never
-- scanned. 'manual' rows are staff overrides (e.g. medical leave).
-- ---------------------------------------------------------
create type attendance_status as enum ('P', 'A', 'M');
create type attendance_source as enum ('scan', 'manual', 'auto_absent');

create table attendance_records (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references attendance_sessions(id) on delete cascade,
  student_id    uuid not null references students(id) on delete restrict,
  status        attendance_status not null,
  source        attendance_source not null,
  scanned_at    timestamptz,       -- set only when source = 'scan'
  marked_by     uuid,              -- references auth.users; staff who scanned or manually set this
  created_at    timestamptz not null default now(),

  unique (session_id, student_id)
);

create index idx_attendance_records_student on attendance_records(student_id);
create index idx_attendance_records_session on attendance_records(session_id);

-- ---------------------------------------------------------
-- 5. ATTENDANCE_CORRECTIONS (audit log — same idea as before)
-- Logs any change to an already-recorded status, e.g. staff
-- overriding a scanned 'P' to 'M' after the fact.
-- ---------------------------------------------------------
create table attendance_corrections (
  id                    uuid primary key default gen_random_uuid(),
  attendance_record_id  uuid not null references attendance_records(id) on delete cascade,
  old_status            attendance_status not null,
  new_status            attendance_status not null,
  reason                text,
  changed_by            uuid,
  changed_at            timestamptz not null default now()
);

create index idx_corrections_record on attendance_corrections(attendance_record_id);

-- ---------------------------------------------------------
-- Reporting views, rebuilt against the new tables
-- ---------------------------------------------------------
create or replace view section_daily_summary as
select
  s.id            as session_id,
  s.school_id,
  s.section_id,
  s.session_date  as attendance_date,
  count(*) filter (where ar.status = 'P') as present_count,
  count(*) filter (where ar.status = 'A') as absent_count,
  count(*) filter (where ar.status = 'M') as medical_count,
  count(*)                                as total_count
from attendance_sessions s
join attendance_records ar on ar.session_id = s.id
group by s.id, s.school_id, s.section_id, s.session_date;

create or replace view student_attendance_summary as
select
  st.id           as student_id,
  st.school_id,
  st.section_id,
  st.roll_number,
  st.full_name,
  count(*) filter (where ar.status = 'P') as present_count,
  count(*) filter (where ar.status = 'A') as absent_count,
  count(*) filter (where ar.status = 'M') as medical_count,
  count(*)                                as total_marked,
  round(
    100.0 * count(*) filter (where ar.status = 'P')
    / nullif(count(*), 0),
    1
  ) as attendance_pct
from students st
join attendance_records ar on ar.student_id = st.id
group by st.id, st.school_id, st.section_id, st.roll_number, st.full_name;
