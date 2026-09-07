-- =========================================================
-- KAAN — Atomic kiosk operations
-- Moves scan + session-close from multiple sequential
-- round-trips (fetch, check, insert) into single Postgres
-- functions. At 33-35 concurrent kiosks during first lecture,
-- this matters for two reasons:
--   1. Fewer round trips = lower latency per scan (students
--      aren't waiting on 3 sequential HTTP+DB calls).
--   2. Atomicity — the old JS-side "check session, then insert"
--      had a race window where a session could close between
--      the check and the write. A single SQL statement (or a
--      function body, which runs as one transaction) closes
--      that window.
-- Both run as SECURITY INVOKER (the default) — they execute
-- with the calling user's own permissions, so existing RLS
-- policies still apply; this isn't a way around RLS.
-- =========================================================

-- Postgres won't let CREATE OR REPLACE change a function's return
-- type — safe to run this whether or not an earlier version of
-- record_scan already exists.
drop function if exists record_scan(uuid, uuid, uuid);

create or replace function record_scan(
  p_session_id uuid,
  p_qr_token uuid,
  p_marked_by uuid
)
returns table(full_name text, roll_number text, is_first_scan boolean)
language plpgsql
as $$
declare
  v_session_status session_status;
  v_section_id uuid;
  v_student_id uuid;
  v_student_name text;
  v_student_roll text;
  v_student_active boolean;
  v_student_section uuid;
  v_is_first_scan boolean;
begin
  select status, section_id into v_session_status, v_section_id
  from attendance_sessions where id = p_session_id;

  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;

  if v_session_status = 'closed' then
    raise exception 'SESSION_CLOSED';
  end if;

  select id, students.full_name, students.roll_number, students.active, students.section_id
  into v_student_id, v_student_name, v_student_roll, v_student_active, v_student_section
  from students where qr_token = p_qr_token;

  if not found then
    raise exception 'STUDENT_NOT_FOUND';
  end if;

  if not v_student_active then
    raise exception 'STUDENT_INACTIVE';
  end if;

  if v_student_section <> v_section_id then
    raise exception 'WRONG_SECTION';
  end if;

  -- (xmax = 0) is a reliable Postgres trick to tell whether this row
  -- was just INSERTed (true) or already existed and got UPDATEd via
  -- ON CONFLICT (false) — i.e. whether this is a first scan or a
  -- repeat scan of an already-present student.
  insert into attendance_records (session_id, student_id, status, source, scanned_at, marked_by)
  values (p_session_id, v_student_id, 'P', 'scan', now(), p_marked_by)
  on conflict (session_id, student_id)
  do update set scanned_at = excluded.scanned_at, status = 'P', source = 'scan', marked_by = excluded.marked_by
  returning (xmax = 0) into v_is_first_scan;

  return query select v_student_name, v_student_roll, v_is_first_scan;
end;
$$;

grant execute on function record_scan(uuid, uuid, uuid) to authenticated;


create or replace function close_attendance_session(
  p_session_id uuid,
  p_closed_by uuid
)
returns table(scanned_count int, auto_absent_count int)
language plpgsql
as $$
declare
  v_section_id uuid;
  v_status session_status;
  v_scanned_count int;
  v_absent_count int;
begin
  select section_id, status into v_section_id, v_status
  from attendance_sessions where id = p_session_id;

  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;

  if v_status = 'closed' then
    raise exception 'SESSION_ALREADY_CLOSED';
  end if;

  select count(*) into v_scanned_count
  from attendance_records where session_id = p_session_id;

  -- Single INSERT...SELECT, not a fetch-both-then-diff-in-app-code
  -- pattern — the "who hasn't scanned yet" check happens inside
  -- the same statement, so there's no window for a scan to land
  -- unseen between reading and writing.
  insert into attendance_records (session_id, student_id, status, source, marked_by)
  select p_session_id, s.id, 'A', 'auto_absent', p_closed_by
  from students s
  where s.section_id = v_section_id
    and s.active = true
    and not exists (
      select 1 from attendance_records ar
      where ar.session_id = p_session_id and ar.student_id = s.id
    );

  get diagnostics v_absent_count = row_count;

  update attendance_sessions
  set status = 'closed', closed_by = p_closed_by, closed_at = now()
  where id = p_session_id;

  return query select v_scanned_count, v_absent_count;
end;
$$;

grant execute on function close_attendance_session(uuid, uuid) to authenticated;
