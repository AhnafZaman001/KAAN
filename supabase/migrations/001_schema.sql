-- =========================================================
-- KAAN — Attendance Digitization Schema
-- School-agnostic: every table is scoped by school_id so this
-- can be sold to multiple colleges, not just KIPS.
-- =========================================================

-- ---------------------------------------------------------
-- 1. SCHOOLS
-- The top-level tenant. Everything else hangs off this.
-- ---------------------------------------------------------
create table schools (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------
-- 2. SECTIONS
-- A "class" / section within a school (e.g. "FSc-1st-A").
-- ---------------------------------------------------------
create table sections (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references schools(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now(),

  unique (school_id, name)
);

-- ---------------------------------------------------------
-- 3. STUDENTS
-- One row per student. Roll number is unique per school
-- (not globally) since two schools may both have a "Roll 1".
-- ---------------------------------------------------------
create table students (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references schools(id) on delete cascade,
  section_id    uuid not null references sections(id) on delete restrict,
  roll_number   text not null,
  full_name     text not null,
  active        boolean not null default true,   -- soft-disable instead of deleting
  created_at    timestamptz not null default now(),

  unique (school_id, roll_number)
);

create index idx_students_section on students(section_id);

-- ---------------------------------------------------------
-- 4. SHEETS
-- One row per scanned attendance sheet = one section, one day.
-- Tracks the OCR job lifecycle for that physical sheet.
-- ---------------------------------------------------------
create type sheet_status as enum (
  'uploaded',      -- photo/scan received, not yet processed
  'processing',    -- OCR pipeline running
  'needs_review',  -- has at least one low-confidence mark pending
  'completed'      -- all marks confirmed/posted
);

create table sheets (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references schools(id) on delete cascade,
  section_id      uuid not null references sections(id) on delete restrict,
  attendance_date date not null,
  image_url       text not null,          -- path in Supabase Storage
  status          sheet_status not null default 'uploaded',
  uploaded_by     uuid,                    -- references auth.users, nullable for now
  created_at      timestamptz not null default now(),

  -- one sheet per section per day
  unique (section_id, attendance_date)
);

create index idx_sheets_school_date on sheets(school_id, attendance_date);

-- ---------------------------------------------------------
-- 5. ATTENDANCE_RECORDS
-- One row per student per sheet = the actual P/A/M mark.
-- ---------------------------------------------------------
create type attendance_status as enum ('P', 'A', 'M');

create table attendance_records (
  id              uuid primary key default gen_random_uuid(),
  sheet_id        uuid not null references sheets(id) on delete cascade,
  student_id      uuid not null references students(id) on delete restrict,
  status          attendance_status not null,
  confidence      numeric(4,3),            -- OCR confidence score, 0.000–1.000
  needs_review    boolean not null default false,
  reviewed_by     uuid,                    -- references auth.users, nullable
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now(),

  -- one mark per student per sheet
  unique (sheet_id, student_id)
);

create index idx_attendance_student on attendance_records(student_id);
create index idx_attendance_sheet on attendance_records(sheet_id);
create index idx_attendance_needs_review on attendance_records(needs_review) where needs_review = true;

-- ---------------------------------------------------------
-- 6. ATTENDANCE_CORRECTIONS (audit log)
-- Every time a posted record is changed after the fact,
-- log the before/after here. attendance_records always
-- reflects current truth; this table is the history.
-- ---------------------------------------------------------
create table attendance_corrections (
  id                    uuid primary key default gen_random_uuid(),
  attendance_record_id  uuid not null references attendance_records(id) on delete cascade,
  old_status            attendance_status not null,
  new_status            attendance_status not null,
  reason                text,
  changed_by            uuid,              -- references auth.users, nullable
  changed_at            timestamptz not null default now()
);

create index idx_corrections_record on attendance_corrections(attendance_record_id);

-- ---------------------------------------------------------
-- Convenience view: daily section summary
-- Powers "attendance % per section per day" style reports
-- without recomputing aggregates in app code.
-- ---------------------------------------------------------
create view section_daily_summary as
select
  s.id            as sheet_id,
  s.school_id,
  s.section_id,
  s.attendance_date,
  count(*) filter (where ar.status = 'P') as present_count,
  count(*) filter (where ar.status = 'A') as absent_count,
  count(*) filter (where ar.status = 'M') as medical_count,
  count(*)                                as total_count
from sheets s
join attendance_records ar on ar.sheet_id = s.id
group by s.id, s.school_id, s.section_id, s.attendance_date;

-- ---------------------------------------------------------
-- Convenience view: per-student attendance % (defaulter list)
-- ---------------------------------------------------------
create view student_attendance_summary as
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
