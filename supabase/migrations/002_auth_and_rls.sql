-- =========================================================
-- KAAN — Auth, Roles & RLS Policies
-- Run this after schema.sql
-- =========================================================

-- ---------------------------------------------------------
-- 1. ROLES ENUM
-- ---------------------------------------------------------
create type user_role as enum ('platform_admin', 'school_admin', 'exam_cell_staff');

-- ---------------------------------------------------------
-- 2. PROFILES
-- Links an auth.users row to a role + school.
-- platform_admin rows have school_id = null (not scoped to one school).
-- Every other role MUST have a school_id.
-- ---------------------------------------------------------
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  school_id   uuid references schools(id) on delete cascade,
  role        user_role not null,
  full_name   text,
  created_at  timestamptz not null default now(),

  constraint school_required_unless_platform_admin
    check (role = 'platform_admin' or school_id is not null)
);

create index idx_profiles_school on profiles(school_id);

alter table profiles enable row level security;

-- Users can see their own profile; platform_admins can see all.
create policy "profiles_select_own_or_admin"
  on profiles for select
  using (
    id = auth.uid()
    or exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role = 'platform_admin'
    )
  );

-- ---------------------------------------------------------
-- Helper functions (used inside policies below)
-- security definer so they can read `profiles` even though
-- profiles itself has RLS on.
-- ---------------------------------------------------------
create or replace function auth_school_id()
returns uuid
language sql security definer stable
as $$
  select school_id from profiles where id = auth.uid();
$$;

create or replace function auth_is_platform_admin()
returns boolean
language sql security definer stable
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'platform_admin'
  );
$$;

create or replace function auth_is_school_admin()
returns boolean
language sql security definer stable
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'school_admin'
  );
$$;

-- ---------------------------------------------------------
-- 3. RLS — SCHOOLS
-- platform_admin: full access.
-- everyone else: can only see their own school.
-- ---------------------------------------------------------
alter table schools enable row level security;

create policy "schools_select"
  on schools for select
  using (auth_is_platform_admin() or id = auth_school_id());

create policy "schools_all_platform_admin"
  on schools for all
  using (auth_is_platform_admin());

-- ---------------------------------------------------------
-- 4. RLS — SECTIONS
-- Read: anyone in that school. Write: school_admin+ only.
-- ---------------------------------------------------------
alter table sections enable row level security;

create policy "sections_select"
  on sections for select
  using (auth_is_platform_admin() or school_id = auth_school_id());

create policy "sections_write"
  on sections for insert with check (
    auth_is_platform_admin()
    or (auth_is_school_admin() and school_id = auth_school_id())
  );

create policy "sections_update"
  on sections for update using (
    auth_is_platform_admin()
    or (auth_is_school_admin() and school_id = auth_school_id())
  );

create policy "sections_delete"
  on sections for delete using (
    auth_is_platform_admin()
    or (auth_is_school_admin() and school_id = auth_school_id())
  );

-- ---------------------------------------------------------
-- 5. RLS — STUDENTS
-- Read: anyone in that school. Write: school_admin+ only.
-- (exam_cell_staff shouldn't be adding/removing students —
-- that's a roster-management action, not day-to-day work.)
-- ---------------------------------------------------------
alter table students enable row level security;

create policy "students_select"
  on students for select
  using (auth_is_platform_admin() or school_id = auth_school_id());

create policy "students_write"
  on students for insert with check (
    auth_is_platform_admin()
    or (auth_is_school_admin() and school_id = auth_school_id())
  );

create policy "students_update"
  on students for update using (
    auth_is_platform_admin()
    or (auth_is_school_admin() and school_id = auth_school_id())
  );

create policy "students_delete"
  on students for delete using (
    auth_is_platform_admin()
    or (auth_is_school_admin() and school_id = auth_school_id())
  );

-- ---------------------------------------------------------
-- 6. RLS — SHEETS
-- Read + write (upload): anyone in that school, including
-- exam_cell_staff — this is their core daily task.
-- ---------------------------------------------------------
alter table sheets enable row level security;

create policy "sheets_select"
  on sheets for select
  using (auth_is_platform_admin() or school_id = auth_school_id());

create policy "sheets_insert"
  on sheets for insert with check (
    auth_is_platform_admin() or school_id = auth_school_id()
  );

create policy "sheets_update"
  on sheets for update using (
    auth_is_platform_admin() or school_id = auth_school_id()
  );

-- ---------------------------------------------------------
-- 7. RLS — ATTENDANCE_RECORDS
-- Scoped via the parent sheet's school_id (attendance_records
-- has no school_id column itself, so we join through sheets).
-- Read + write (review/confirm): anyone in that school.
-- ---------------------------------------------------------
alter table attendance_records enable row level security;

create policy "attendance_records_select"
  on attendance_records for select
  using (
    auth_is_platform_admin()
    or exists (
      select 1 from sheets s
      where s.id = attendance_records.sheet_id
      and s.school_id = auth_school_id()
    )
  );

create policy "attendance_records_insert"
  on attendance_records for insert with check (
    auth_is_platform_admin()
    or exists (
      select 1 from sheets s
      where s.id = attendance_records.sheet_id
      and s.school_id = auth_school_id()
    )
  );

create policy "attendance_records_update"
  on attendance_records for update using (
    auth_is_platform_admin()
    or exists (
      select 1 from sheets s
      where s.id = attendance_records.sheet_id
      and s.school_id = auth_school_id()
    )
  );

-- ---------------------------------------------------------
-- 8. RLS — ATTENDANCE_CORRECTIONS (audit log)
-- Read: anyone in that school (transparency).
-- Write: system/backend only in practice, but we still scope
-- it — any authenticated school user can log a correction,
-- nobody can edit or delete history once written.
-- No update/delete policy at all = audit log is append-only.
-- ---------------------------------------------------------
alter table attendance_corrections enable row level security;

create policy "corrections_select"
  on attendance_corrections for select
  using (
    auth_is_platform_admin()
    or exists (
      select 1 from attendance_records ar
      join sheets s on s.id = ar.sheet_id
      where ar.id = attendance_corrections.attendance_record_id
      and s.school_id = auth_school_id()
    )
  );

create policy "corrections_insert"
  on attendance_corrections for insert with check (
    auth_is_platform_admin()
    or exists (
      select 1 from attendance_records ar
      join sheets s on s.id = ar.sheet_id
      where ar.id = attendance_corrections.attendance_record_id
      and s.school_id = auth_school_id()
    )
  );
