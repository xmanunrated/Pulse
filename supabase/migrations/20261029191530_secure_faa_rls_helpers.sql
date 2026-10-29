-- Required project setting: keep `private` out of the Supabase API's Exposed schemas.
-- RLS policies still need authenticated EXECUTE on these helpers.
create schema if not exists private;

-- Moving the existing functions preserves their object identity, so policies
-- that already reference them continue to work.
alter function public.faa_is_org_member(uuid) set schema private;
alter function public.faa_has_org_role(uuid, text[]) set schema private;

-- SECURITY DEFINER functions use an empty search_path and fully qualified
-- references to prevent object shadowing.
create or replace function private.faa_is_org_member(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.faa_organization_members as m
    where m.org_id = target_org
      and m.user_id = auth.uid()
  );
$function$;

create or replace function private.faa_has_org_role(target_org uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.faa_organization_members as m
    where m.org_id = target_org
      and m.user_id = auth.uid()
      and m.role = any(allowed_roles)
  );
$function$;

revoke all on function private.faa_is_org_member(uuid) from public, anon;
revoke all on function private.faa_has_org_role(uuid, text[]) from public, anon;
grant execute on function private.faa_is_org_member(uuid) to authenticated;
grant execute on function private.faa_has_org_role(uuid, text[]) to authenticated;
