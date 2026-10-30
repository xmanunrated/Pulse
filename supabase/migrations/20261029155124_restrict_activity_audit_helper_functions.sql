revoke all on function public.faa_is_org_member(uuid) from public, anon;
revoke all on function public.faa_has_org_role(uuid, text[]) from public, anon;
grant execute on function public.faa_is_org_member(uuid) to authenticated;
grant execute on function public.faa_has_org_role(uuid, text[]) to authenticated;
