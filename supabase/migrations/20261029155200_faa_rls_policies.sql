-- RLS policies for tenant-isolated Farmer Activity Audit tables.
-- Reconcile all prior FAA policy aliases before creating a single explicit policy
-- set. This avoids permissive PostgreSQL policies OR-ing together after a partial
-- manual deployment.
REVOKE ALL ON FUNCTION public.faa_is_org_member(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.faa_has_org_role(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.faa_is_org_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.faa_has_org_role(uuid, text[]) TO authenticated;

DO $$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY (ARRAY[
        'faa_organizations',
        'faa_organization_members',
        'faa_products',
        'faa_product_knowledge_versions',
        'faa_activities',
        'faa_farmers',
        'faa_activity_participants',
        'faa_sampling_batches',
        'faa_audit_calls',
        'faa_call_assessments',
        'faa_audit_events'
      ])
  LOOP
    EXECUTE format(
      'DROP POLICY %I ON %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  END LOOP;
END;
$;

CREATE POLICY faa_org_select
  ON public.faa_organizations FOR SELECT TO authenticated
  USING (public.faa_is_org_member(id));

-- Membership changes stay in the Supabase administrative workflow until the
-- app has a dedicated, reviewed invitation flow.
CREATE POLICY faa_members_select
  ON public.faa_organization_members FOR SELECT TO authenticated
  USING (public.faa_is_org_member(org_id));

CREATE POLICY faa_products_select
  ON public.faa_products FOR SELECT TO authenticated
  USING (public.faa_is_org_member(org_id));
CREATE POLICY faa_products_insert
  ON public.faa_products FOR INSERT TO authenticated
  WITH CHECK (public.faa_has_org_role(org_id, ARRAY['owner','admin','auditor']));
CREATE POLICY faa_products_update
  ON public.faa_products FOR UPDATE TO authenticated
  USING (public.faa_has_org_role(org_id, ARRAY['owner','admin','auditor']))
  WITH CHECK (public.faa_has_org_role(org_id, ARRAY['owner','admin','auditor']));
CREATE POLICY faa_products_delete
  ON public.faa_products FOR DELETE TO authenticated
  USING (public.faa_has_org_role(org_id, ARRAY['owner','admin']));

CREATE POLICY faa_knowledge_select
  ON public.faa_product_knowledge_versions FOR SELECT TO authenticated
  USING (public.faa_is_org_member(org_id));
CREATE POLICY faa_knowledge_insert
  ON public.faa_product_knowledge_versions FOR INSERT TO authenticated
  WITH CHECK (public.faa_has_org_role(org_id, ARRAY['owner','admin','auditor']));
CREATE POLICY faa_knowledge_update
  ON public.faa_product_knowledge_versions FOR UPDATE TO authenticated
  USING (public.faa_has_org_role(org_id, ARRAY['owner','admin','auditor','reviewer']))
  WITH CHECK (public.faa_has_org_role(org_id, ARRAY['owner','admin','auditor','reviewer']));
CREATE POLICY faa_knowledge_delete
  ON public.faa_product_knowledge_versions FOR DELETE TO authenticated
  USING (public.faa_has_org_role(org_id, ARRAY['owner','admin']));

CREATE POLICY faa_activities_select
  ON public.faa_activities FOR SELECT TO authenticated
  USING (public.faa_is_org_member(org_id));
CREATE POLICY faa_activities_insert
  ON public.faa_activities FOR INSERT TO authenticated
  WITH CHECK (public.faa_has_org_role(org_id, ARRAY['owner','admin','auditor']));
CREATE POLICY faa_activities_update
  ON public.faa_activities FOR UPDATE TO authenticated
  USING (public.faa_has_org_role(org_id, ARRAY['owner','admin','auditor']))
  WITH CHECK (public.faa_has_org_role(org_id, ARRAY['owner','admin','auditor']));
CREATE POLICY faa_activities_delete
  ON public.faa_activities FOR DELETE TO authenticated
  USING (public.faa_has_org_role(org_id, ARRAY['owner','admin']));

CREATE POLICY faa_farmers_select
  ON public.faa_farmers FOR SELECT TO authenticated
  USING (public.faa_is_org_member(org_id));
CREATE POLICY faa_farmers_insert
  ON public.faa_farmers FOR INSERT TO authenticated
  WITH CHECK (public.faa_has_org_role(org_id, ARRAY['owner','admin','auditor']));
CREATE POLICY faa_farmers_update
  ON public.faa_farmers FOR UPDATE TO authenticated
  USING (public.faa_has_org_role(org_id, ARRAY['owner','admin','auditor']))
  WITH CHECK (public.faa_has_org_role(org_id, ARRAY['owner','admin','auditor']));
CREATE POLICY faa_farmers_delete
  ON public.faa_farmers FOR DELETE TO authenticated
  USING (public.faa_has_org_role(org_id, ARRAY['owner','admin']));

CREATE POLICY faa_participants_select
  ON public.faa_activity_participants FOR SELECT TO authenticated
  USING (public.faa_is_org_member(org_id));
CREATE POLICY faa_participants_insert
  ON public.faa_activity_participants FOR INSERT TO authenticated
  WITH CHECK (public.faa_has_org_role(org_id, ARRAY['owner','admin','auditor']));
CREATE POLICY faa_participants_update
  ON public.faa_activity_participants FOR UPDATE TO authenticated
  USING (public.faa_has_org_role(org_id, ARRAY['owner','admin','auditor']))
  WITH CHECK (public.faa_has_org_role(org_id, ARRAY['owner','admin','auditor']));
CREATE POLICY faa_participants_delete
  ON public.faa_activity_participants FOR DELETE TO authenticated
  USING (public.faa_has_org_role(org_id, ARRAY['owner','admin']));

CREATE POLICY faa_sampling_select
  ON public.faa_sampling_batches FOR SELECT TO authenticated
  USING (public.faa_is_org_member(org_id));
CREATE POLICY faa_sampling_insert
  ON public.faa_sampling_batches FOR INSERT TO authenticated
  WITH CHECK (public.faa_has_org_role(org_id, ARRAY['owner','admin','auditor']));
CREATE POLICY faa_sampling_update
  ON public.faa_sampling_batches FOR UPDATE TO authenticated
  USING (public.faa_has_org_role(org_id, ARRAY['owner','admin','auditor','reviewer']))
  WITH CHECK (public.faa_has_org_role(org_id, ARRAY['owner','admin','auditor','reviewer']));
CREATE POLICY faa_sampling_delete
  ON public.faa_sampling_batches FOR DELETE TO authenticated
  USING (public.faa_has_org_role(org_id, ARRAY['owner','admin']));

CREATE POLICY faa_calls_select
  ON public.faa_audit_calls FOR SELECT TO authenticated
  USING (public.faa_is_org_member(org_id));
CREATE POLICY faa_calls_insert
  ON public.faa_audit_calls FOR INSERT TO authenticated
  WITH CHECK (public.faa_has_org_role(org_id, ARRAY['owner','admin','auditor']));
CREATE POLICY faa_calls_update
  ON public.faa_audit_calls FOR UPDATE TO authenticated
  USING (public.faa_has_org_role(org_id, ARRAY['owner','admin','auditor']))
  WITH CHECK (public.faa_has_org_role(org_id, ARRAY['owner','admin','auditor']));
CREATE POLICY faa_calls_delete
  ON public.faa_audit_calls FOR DELETE TO authenticated
  USING (public.faa_has_org_role(org_id, ARRAY['owner','admin']));

CREATE POLICY faa_assessments_select
  ON public.faa_call_assessments FOR SELECT TO authenticated
  USING (public.faa_is_org_member(org_id));
CREATE POLICY faa_assessments_insert
  ON public.faa_call_assessments FOR INSERT TO authenticated
  WITH CHECK (public.faa_has_org_role(org_id, ARRAY['owner','admin','auditor']));
CREATE POLICY faa_assessments_update
  ON public.faa_call_assessments FOR UPDATE TO authenticated
  USING (public.faa_has_org_role(org_id, ARRAY['owner','admin','auditor','reviewer']))
  WITH CHECK (public.faa_has_org_role(org_id, ARRAY['owner','admin','auditor','reviewer']));
CREATE POLICY faa_assessments_delete
  ON public.faa_call_assessments FOR DELETE TO authenticated
  USING (public.faa_has_org_role(org_id, ARRAY['owner','admin']));

-- Audit events are append-only. Only authorized workspace actors may append,
-- and the event must identify the authenticated actor.
CREATE POLICY faa_events_select
  ON public.faa_audit_events FOR SELECT TO authenticated
  USING (public.faa_is_org_member(org_id));
CREATE POLICY faa_events_insert
  ON public.faa_audit_events FOR INSERT TO authenticated
  WITH CHECK (
    actor_id = auth.uid()
    AND public.faa_has_org_role(org_id, ARRAY['owner','admin','auditor','reviewer'])
  );
