-- =========================================================
-- KAAN — RLS for QR attendance tables
-- Run this AFTER 004_qr_attendance.sql
-- =========================================================

-- ---------------------------------------------------------
-- ATTENDANCE_SESSIONS
-- Anyone in the school can read/open/close sessions — this is
-- the kiosk's core daily task, same reasoning as sheets before.
-- ---------------------------------------------------------
alter table attendance_sessions enable row level security;

create policy "sessions_select"
  on attendance_sessions for select
  using (auth_is_platform_admin() or school_id = auth_school_id());

create policy "sessions_insert"
  on attendance_sessions for insert with check (
    auth_is_platform_admin() or school_id = auth_school_id()
  );

create policy "sessions_update"
  on attendance_sessions for update using (
    auth_is_platform_admin() or school_id = auth_school_id()
  );

-- ---------------------------------------------------------
-- ATTENDANCE_RECORDS
-- Scoped via the parent session's school_id, same pattern as
-- the old sheet-based policies.
-- ---------------------------------------------------------
alter table attendance_records enable row level security;

create policy "attendance_records_select"
  on attendance_records for select
  using (
    auth_is_platform_admin()
    or exists (
      select 1 from attendance_sessions s
      where s.id = attendance_records.session_id
      and s.school_id = auth_school_id()
    )
  );

create policy "attendance_records_insert"
  on attendance_records for insert with check (
    auth_is_platform_admin()
    or exists (
      select 1 from attendance_sessions s
      where s.id = attendance_records.session_id
      and s.school_id = auth_school_id()
    )
  );

create policy "attendance_records_update"
  on attendance_records for update using (
    auth_is_platform_admin()
    or exists (
      select 1 from attendance_sessions s
      where s.id = attendance_records.session_id
      and s.school_id = auth_school_id()
    )
  );

-- ---------------------------------------------------------
-- ATTENDANCE_CORRECTIONS — append-only audit log, same as before
-- ---------------------------------------------------------
alter table attendance_corrections enable row level security;

create policy "corrections_select"
  on attendance_corrections for select
  using (
    auth_is_platform_admin()
    or exists (
      select 1 from attendance_records ar
      join attendance_sessions s on s.id = ar.session_id
      where ar.id = attendance_corrections.attendance_record_id
      and s.school_id = auth_school_id()
    )
  );

create policy "corrections_insert"
  on attendance_corrections for insert with check (
    auth_is_platform_admin()
    or exists (
      select 1 from attendance_records ar
      join attendance_sessions s on s.id = ar.session_id
      where ar.id = attendance_corrections.attendance_record_id
      and s.school_id = auth_school_id()
    )
  );
