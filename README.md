# FieldLens AI — Farmer Activity Audit

A Hindi/Bhojpuri-ready B2B SaaS foundation for independently auditing company-reported field activities with consent-based farmer interviews and source-linked product knowledge.

## What is in this build

- **Web dashboard (`apps/web`)**: responsive overview, activity register, product knowledge status, consent eligibility register, sample-batch creation, call queue, reports and CSV export.
- **Demo workflow**: add activities/products, import simple CSV, filter activity rows, create reproducible sample selections, queue simulated calls and export reports. Demo records are stored in browser localStorage.
- **Supabase schema foundation**: tenant/organization membership, product knowledge versions, activities, farmers, activity participants/consent, sampling batches, audit calls, assessments and audit event log. RLS is enabled on the new `faa_*` tables.
- **Authenticated web workspace (`/secure-workspace`)**: existing-account email-link sign-in, organization-scoped activities/products/knowledge, consent-evidence CSV import, an opt-out register, source-linked knowledge drafts/review, and sample-batch preparation/approval. All API requests verify the Supabase bearer token and use the caller JWT so RLS remains in force.
- **Farmer data protection**: India mobile numbers are normalized, HMAC-deduplicated, and encrypted server-side with AES-256-GCM. Phone values are never returned to the browser. Imports are limited to 4 MB and 5,000 rows to fit Vercel Function request limits; a CSV template is available in the workspace.
- **NestJS API (`apps/api`)**: health endpoint and authenticated activity list/create routes. The API verifies Supabase access tokens and checks organization roles for writes; it does not use a service-role key.
- **Voice and queue worker scaffolds**: separate persistent-service entry points; they do not call real numbers or connect to a provider by default.
- **Shared Zod contracts (`packages/shared`)** for import and assessment payloads.

## Supabase project

- Project ref: `xipngakadtsalyohgugb`
- URL: `https://xipngakadtsalyohgugb.supabase.co`
- Region: Mumbai (`ap-south-1`)
- Dashboard: https://supabase.com/dashboard/project/xipngakadtsalyohgugb
- Creation quote at setup: **$0/month**. No paid upgrade was approved. Recheck current plan and usage in Supabase before production traffic.
- Applied live migration: `20261029155116_farmer_activity_audit_core`.
- The older complaint tables from the earlier mistaken scaffold have been left untouched; the application UI no longer uses them. Do not delete those tables without a deliberate migration review.

## Run locally

Prerequisites: Node.js 20+, pnpm 10+.

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local
cp apps/api/.env.example apps/api/.env
pnpm dev
```

In a second terminal, start the API with `pnpm --filter @faa/api dev`. Open `http://localhost:3000` for the localStorage demo dashboard, `/secure-activities` for protected activity management, or `/secure-workspace` for the authenticated farmer audit prototype. Add both local secure paths and the preview workspace path to Supabase's email redirect allowlist. For farmer import, set `FAA_PHONE_ENCRYPTION_KEY` and `FAA_PHONE_HMAC_KEY` as independent base64-encoded 32-byte server-only secrets (for example, generate each separately with `openssl rand -base64 32`). Never expose either key through a `NEXT_PUBLIC_*` variable. The main dashboard remains demo-only; setting Supabase URL/key alone does **not** switch its data to live mode.

## Monorepo packages

- `apps/web`: Next.js App Router + TypeScript + Tailwind v4
- `apps/api`: NestJS REST API
- `apps/voice-worker`: persistent voice/audio service placeholder (not a Vercel serverless function)
- `apps/job-worker`: background queue placeholder
- `packages/shared`: shared Zod schemas/contracts
- `supabase/migrations`: SQL source-control migrations for the FAA core and tenant policies

## Current safety / product boundaries

- No real outbound phone calls are enabled.
- No Exotel credentials or voice-model credentials are included.
- No real farmer phone numbers or personal records are seeded; the visible names and scores are demo data.
- The authenticated workspace stages and approves draft sample batches only. Its start endpoint always returns `LIVE_CALLING_DISABLED`; it has no provider dispatch path.
- Unknown, declined, withdrawn, suppressed, incomplete-consent, and opted-out participants are excluded from eligible call samples. Consent requires method, purpose, source, timestamp, and an evidence reference. An opt-out is organization-wide and suppresses the farmer from future samples.
- Call scoring is a review aid, not a finding of employee misconduct. Human review is required for low confidence or conflicting evidence.
- Phone encryption/HMAC are implemented for the authenticated CSV importer. Webhook signature verification, idempotent dispatch, consent re-checks at dispatch time, recording-consent handling, and audit transcript evidence remain unimplemented.
- The live Supabase security advisor reported warnings on authenticated execution of two `SECURITY DEFINER` membership helper functions. A migration moves the helpers to `private`, but it has not been applied; verify the cloud API exposed-schema setting and migration history, apply through a reviewed release, and rerun the advisor before production. Do not treat the current security review as fully cleared.
- The farmer-import migration `20261030130000_farmer_import_and_call_gates.sql` is committed in source but not applied to Supabase. Import and farmer listing therefore remain unavailable until the migration is reviewed/applied and server-only phone keys are configured.
- The Supabase project was previously verified to have no Auth users, organizations, memberships or activities. Sign-in only accepts existing users; provision the internal QA user and an owner membership through a controlled admin workflow before using the page. The application does not provide open self-service organization creation.

## Next production gates

1. Provision the internal QA Auth user and organization owner membership; confirm Supabase email redirects for both secure pages.
2. Review and reconcile the pending `private` helper and farmer-import migrations against the live Supabase schema and migration ledger, then rerun security/performance advisors.
3. Configure independent phone-protection secrets in the server runtime and verify import/opt-out behavior with synthetic test records only.
4. Add automated route tests, CSV fuzz/error coverage, rate limits, operational monitoring, data retention, backups and restore validation.
5. Select a telephony vendor and confirm account/KYC/access plus Indian telecom, preference and purpose-specific consent requirements. Implement and separately authorize any provider integration; no provider path is currently present.
6. Implement signed provider callbacks, idempotent dispatch, consent checks at dispatch, safe call recording/transcription, Hindi/Bhojpuri conversation handling, source-grounded assessment, and human review before any live calling.

## Environment variables

See `apps/web/.env.example` for the browser URL/publishable key and server-only farmer phone protection keys. See `apps/api/.env.example` for the API URL, publishable key and allowed web origin. Never put a service-role key in browser code or expose any server-only secret through a `NEXT_PUBLIC_*` variable. The authenticated app uses caller-scoped tokens and no service-role credential.

## Activity API

- `GET /v1/organizations` returns only the signed-in user's organization memberships and role, subject to RLS.
- `GET /v1/activities` accepts an optional `orgId` UUID and returns at most 500 rows visible to the authenticated user through RLS.
- `POST /v1/activities` accepts `orgId`, `staffRef`, `village`, `activityDate`, `productSku`, `reportedFarmerCount` and an optional `externalRef`. Only organization owners, admins and auditors may create records. Product SKU and reported farmer count are stored in activity metadata.
- `/v1/products`, `/v1/knowledge`, `/v1/farmers`, `/v1/farmers/import`, `/v1/farmers/{id}/opt-out`, and `/v1/call-batches` provide the authenticated prototype workflow. Knowledge is entered as source-linked claims and must be approved; import accepts CSV only; call batches remain drafts/approvals and never dispatch.
- Requests require `Authorization: Bearer <Supabase access token>`. The secure activity prototype uses this API; the main demo dashboard does not.
- Email-link sign-in only permits existing Supabase accounts. Configure allowed redirect URLs in Supabase before using it; this repository does not initiate sign-in emails on its own.
