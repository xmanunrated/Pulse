# Secure prototype setup

This runbook is for a local, internal QA session. It does not deploy the app, enable public sign-up, or initiate farmer calls.

## Current state (checked 2026-10-30)

- The Supabase project is active and healthy, but the live database has no FAA organizations, memberships, or activities.
- The secure page only signs in existing Supabase users. An organization membership is required before it can show activity data.
- No Pulse project or deployment was found in the connected Vercel account. Other hosting providers were not checked. Supabase hosts the database and Auth services; it does not host this web app or NestJS API.
- The repository migration `20261029155200_faa_rls_policies.sql` is not recorded in the live migration ledger even though the expected policies are present. The pending `20261029191530_secure_faa_rls_helpers.sql` migration has not been applied. Do not run a bulk migration push until the ledger discrepancy and cloud API exposed-schema setting have been reviewed.

## Local setup

1. Copy the examples to local environment files and fill in the Supabase project URL and publishable key. Keep these files out of Git.
   - Web: `apps/web/.env.local`
   - API: `apps/api/.env`
2. Confirm `NEXT_PUBLIC_FAA_API_URL=http://localhost:4000/v1` and `WEB_ORIGIN=http://localhost:3000`.
3. In Supabase Auth URL Configuration, allow the exact local redirect URL `http://localhost:3000/secure-activities`.
4. Start the web app with `pnpm dev`, then start the API in a second terminal with `pnpm --filter @faa/api dev`.
5. Open `http://localhost:3000/secure-activities`. The main dashboard remains a separate localStorage demo.

The API uses the Supabase publishable key and the signed-in user's access token. Do not add a service-role key to either app's environment.

## First internal QA organization

Use an existing internal test account. Keep public sign-up disabled. A trusted project operator can create a synthetic organization and assign that account its initial owner membership through the Supabase SQL Editor. This is an administrative data change; the SQL below is documentation only and has not been run.

Replace the UUID placeholder with the ID of the existing internal test account from Supabase Auth. Run the block once:

```sql
begin;

with new_org as (
  insert into public.faa_organizations (name)
  values ('FieldLens QA')
  returning id
)
insert into public.faa_organization_members (org_id, user_id, role)
select id, 'REPLACE-WITH-EXISTING-AUTH-USER-UUID'::uuid, 'owner'
from new_org;

commit;
```

Then sign in with that account, confirm it sees the organization, and create only synthetic activity data (for example, a QA staff reference and a clearly synthetic village name). Do not enter farmer names, phone numbers, or other personal records.

## Database security gate

Before applying the pending helper migration or exposing the secure page to users:

1. In Supabase API settings, verify that `private` is not in the cloud project's Exposed schemas.
2. Reconcile the missing `20261029155200_faa_rls_policies` migration against the live migration ledger and actual policies. Do not mark a migration applied or reapply migrations without confirming the live schema matches.
3. Review and apply the helper migration through a controlled release.
4. Rerun the Supabase security advisor and confirm the two public SECURITY DEFINER helper findings are resolved.

No live DDL has been applied as part of this runbook.

## When remote access is needed

To let users access the prototype outside a developer's machine, deploy both the Next.js web app (`apps/web`) and NestJS API (`apps/api`) to hosting. Configure the production web origin in the API's `WEB_ORIGIN`, the public API URL in `NEXT_PUBLIC_FAA_API_URL`, and the exact production sign-in redirect in Supabase Auth. Keep the Supabase publishable key in the browser and any server-only credentials out of browser variables.

No Vercel project or deployment was found in the connected account. The secure page still does not place or schedule calls.
