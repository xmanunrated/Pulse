-- RLS policies for tenant-isolated Farmer Activity Audit tables.
REVOKE ALL ON FUNCTION public.faa_is_org_member(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.faa_has_org_role(uuid,text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.faa_is_org_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.faa_has_org_role(uuid,text[]) TO authenticated;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='faa_organizations' AND policyname='faa_org_select') THEN CREATE POLICY faa_org_select ON public.faa_organizations FOR SELECT TO authenticated USING(public.faa_is_org_member(id)); END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='faa_organization_members' AND policyname='faa_members_select') THEN CREATE POLICY faa_members_select ON public.faa_organization_members FOR SELECT TO authenticated USING(public.faa_is_org_member(org_id)); END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='faa_organization_members' AND policyname='faa_members_admin') THEN CREATE POLICY faa_members_admin ON public.faa_organization_members FOR ALL TO authenticated USING(public.faa_has_org_role(org_id,ARRAY['owner','admin'])) WITH CHECK(public.faa_has_org_role(org_id,ARRAY['owner','admin'])); END IF;
END $$;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['faa_products','faa_product_knowledge_versions','faa_activities','faa_farmers','faa_activity_participants','faa_sampling_batches','faa_audit_calls','faa_call_assessments','faa_audit_events'] LOOP
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname=t||'_select') THEN EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING(public.faa_is_org_member(org_id))',t||'_select',t); END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname=t||'_insert') THEN EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK(public.faa_has_org_role(org_id,ARRAY[''owner'',''admin'',''auditor'']))',t||'_insert',t); END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname=t||'_update') THEN EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING(public.faa_has_org_role(org_id,ARRAY[''owner'',''admin'',''auditor'',''reviewer''])) WITH CHECK(public.faa_has_org_role(org_id,ARRAY[''owner'',''admin'',''auditor'',''reviewer'']))',t||'_update',t); END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname=t||'_delete') THEN EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING(public.faa_has_org_role(org_id,ARRAY[''owner'',''admin'']))',t||'_delete',t); END IF;
END LOOP; END $$;
