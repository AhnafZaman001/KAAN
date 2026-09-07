-- =========================================================
-- KAAN — Scan rate limiting + audit trail
-- Converges two related gaps into one design: every scan attempt
-- (successful or not) gets logged, and that same log is what the
-- rate limit checks against — no separate infrastructure needed.
-- =========================================================

-- ---------------------------------------------------------
-- 1. SCAN_ATTEMPTS — audit log of every scan attempt.
-- Logged inside record_scan itself (see below) so this stays a
-- single round-trip from the API route, not an extra query.
-- ---------------------------------------------------------
create table scan_attempts (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid references schools(id) on delete cascade,
  session_id    uuid,               -- not a hard FK: a bad/expired session_id is itself worth logging
  attempted_by  uuid not null,      -- references auth.users
  qr_token      uuid,
  outcome       text not null,      -- 'first_scan', 'repeat_scan', or the error code
  ip_address    text,
  user_agent    text,
  created_at    timestamptz not null default now()
);

create index idx_scan_attempts_user_time on scan_attempts(attempted_by, created_at);
create index idx_scan_attempts_school on scan_attempts(school_id);

alter table scan_attempts enable row level security;

-- Visible to school_admin/platform_admin only — this is an
-- operational/security log, not something exam_cell_staff need to
-- see day to day.
create policy "scan_attempts_select"
  on scan_attempts for select
  using (
    auth_is_platform_admin()
    or (auth_is_school_admin() and school_id = auth_school_id())
  );

-- Insert happens from inside record_scan (SECURITY INVOKER, so as
-- the calling user) — any authenticated school user can write their
-- own attempt log entries. school_id can be NULL here specifically
-- when the given session_id didn't resolve to a real session (that
-- failure is exactly what's worth logging, so this can't require a
-- valid school scope to succeed).
create policy "scan_attempts_insert"
  on scan_attempts for insert with check (
    school_id is null or auth_is_platform_admin() or school_id = auth_school_id()
  );

-- ---------------------------------------------------------
-- 2. Device visibility on session open/close.
-- attendance_sessions already has opened_by/closed_by (who) and
-- opened_at/closed_at (when) — this adds "from where."
-- ---------------------------------------------------------
alter table attendance_sessions
  add column opened_from_ip text,
  add column opened_user_agent text,
  add column closed_from_ip text,
  add column closed_user_agent text;

-- ---------------------------------------------------------
-- 3. record_scan — now rate-limited and audited.
-- Signature changed (2 new params), so drop first.
-- ---------------------------------------------------------
drop function if exists record_scan(uuid, uuid, uuid);

create or replace function record_scan(
  p_session_id uuid,
  p_qr_token uuid,
  p_marked_by uuid,
  p_ip_address text default null,
  p_user_agent text default null
)
returns table(full_name text, roll_number text, is_first_scan boolean)
language plpgsql
as $$
declare
  v_session_status session_status;
  v_section_id uuid;
  v_school_id uuid;
  v_student_id uuid;
  v_student_name text;
  v_student_roll text;
  v_student_active boolean;
  v_student_section uuid;
  v_is_first_scan boolean;
  v_recent_attempts int;
  v_outcome text;
begin
  -- Rate limit: generous enough that a legitimately busy kiosk never
  -- notices it (the client already self-throttles to ~1 attempt per
  -- 2.5s per QR code), but it catches a runaway script hammering the
  -- endpoint. Checked against the same log this function writes to.
  select count(*) into v_recent_attempts
  from scan_attempts
  where attempted_by = p_marked_by
    and created_at > now() - interval '10 seconds';

  if v_recent_attempts >= 20 then
    raise exception 'RATE_LIMITED';
  end if;

  select status, section_id, school_id into v_session_status, v_section_id, v_school_id
  from attendance_sessions where id = p_session_id;

  begin
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

    insert into attendance_records (session_id, student_id, status, source, scanned_at, marked_by)
    values (p_session_id, v_student_id, 'P', 'scan', now(), p_marked_by)
    on conflict (session_id, student_id)
    do update set scanned_at = excluded.scanned_at, status = 'P', source = 'scan', marked_by = excluded.marked_by
    returning (xmax = 0) into v_is_first_scan;

    v_outcome := case when v_is_first_scan then 'first_scan' else 'repeat_scan' end;
  exception when others then
    -- Log the failed attempt (school_id may be null if the session
    -- itself wasn't found — still worth logging who tried what).
    insert into scan_attempts (school_id, session_id, attempted_by, qr_token, outcome, ip_address, user_agent)
    values (v_school_id, p_session_id, p_marked_by, p_qr_token, SQLERRM, p_ip_address, p_user_agent);
    raise; -- re-raise so the API route's error handling still works unchanged
  end;

  insert into scan_attempts (school_id, session_id, attempted_by, qr_token, outcome, ip_address, user_agent)
  values (v_school_id, p_session_id, p_marked_by, p_qr_token, v_outcome, p_ip_address, p_user_agent);

  return query select v_student_name, v_student_roll, v_is_first_scan;
end;
$$;

grant execute on function record_scan(uuid, uuid, uuid, text, text) to authenticated;

-- ---------------------------------------------------------
-- 4. close_attendance_session — now also records device info.
-- ---------------------------------------------------------
drop function if exists close_attendance_session(uuid, uuid);

create or replace function close_attendance_session(
  p_session_id uuid,
  p_closed_by uuid,
  p_ip_address text default null,
  p_user_agent text default null
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
  set status = 'closed',
      closed_by = p_closed_by,
      closed_at = now(),
      closed_from_ip = p_ip_address,
      closed_user_agent = p_user_agent
  where id = p_session_id;

  return query select v_scanned_count, v_absent_count;
end;
$$;

grant execute on function close_attendance_session(uuid, uuid, text, text) to authenticated;
