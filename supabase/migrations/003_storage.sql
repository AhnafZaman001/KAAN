-- =========================================================
-- KAAN — Storage bucket for photographed attendance sheets
-- Run this AFTER 001_schema.sql and 002_auth_and_rls.sql
-- =========================================================

insert into storage.buckets (id, name, public)
values ('attendance-sheets', 'attendance-sheets', false)
on conflict (id) do nothing;

-- Path convention: {school_id}/{section_id}/{attendance_date}.jpg
-- RLS on storage.objects checks the first path segment against the
-- uploading user's school_id, same pattern as the table policies.

create policy "sheets_storage_select"
  on storage.objects for select
  using (
    bucket_id = 'attendance-sheets'
    and (
      auth_is_platform_admin()
      or (storage.foldername(name))[1] = auth_school_id()::text
    )
  );

create policy "sheets_storage_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'attendance-sheets'
    and (
      auth_is_platform_admin()
      or (storage.foldername(name))[1] = auth_school_id()::text
    )
  );
