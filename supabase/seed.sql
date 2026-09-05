-- =========================================================
-- KAAN — Seed Data (KIPS test school)
-- Run this AFTER schema.sql and auth_and_rls.sql
-- Run as the Supabase project owner (SQL editor uses your
-- service role by default, so RLS won't block this).
-- =========================================================

-- ---------------------------------------------------------
-- 1. School
-- ---------------------------------------------------------
insert into schools (id, name)
values ('11111111-1111-1111-1111-111111111111', 'KIPS College')
returning id;

-- ---------------------------------------------------------
-- 2. A couple of test sections
-- ---------------------------------------------------------
insert into sections (id, school_id, name)
values
  ('22222222-2222-2222-2222-222222222221', '11111111-1111-1111-1111-111111111111', 'FSc-1st-A'),
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'FSc-1st-B')
returning id, name;

-- ---------------------------------------------------------
-- 3. A handful of test students in FSc-1st-A
-- ---------------------------------------------------------
insert into students (school_id, section_id, roll_number, full_name)
values
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222221', '101', 'Ali Raza'),
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222221', '102', 'Sara Khan'),
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222221', '103', 'Bilal Ahmed'),
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222221', '104', 'Ayesha Malik'),
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222221', '105', 'Hamza Sheikh');

-- ---------------------------------------------------------
-- 4. Link your admin user to this school
-- Run this AFTER you've created the auth user (see steps).
-- Replace <AUTH_USER_ID> with the UUID from step 2 below.
-- ---------------------------------------------------------
-- insert into profiles (id, school_id, role, full_name)
-- values (
--   '<AUTH_USER_ID>',
--   '11111111-1111-1111-1111-111111111111',
--   'school_admin',
--   'Your Name'
-- );
