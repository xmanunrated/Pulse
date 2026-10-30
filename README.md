# FieldLens AI — Farmer Activity Audit

A Hindi/Bhojpuri-ready B2B SaaS foundation for independently auditing company-reported field activities with consent-based farmer interviews and source-linked product knowledge.

## What is in this build

- **Web dashboard (`apps/web`)**: responsive overview, activity register, product knowledge status, consent eligibility register, sample-batch creation, call queue, reports and CSV export.
- **Demo workflow**: add activities/products, import simple CSV, filter activity rows, create reproducible sample selections, queue simulated calls and export reports. Demo records are stored in browser localStorage.
- **Supabase schema foundation**: tenant/organization membership, product knowledge versions, activities, farmers, activity participants/consent, sampling batches, audit calls, assessments and audit event log. RLS is enabled on the new `faa_*` tables.
- **NestJS API (`apps/api`)**: health endpoint and authenticated activity list/create routes. The API verifies Supabase access tokens, checks organization roles for writes and uses the caller's JWT so Supabase RLS remains in force; it does not use a service-role key. The dashboard is still a localStorage demo and does not call these routes.
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
pnpm dev
```

Open `http://localhost:3000`. The dashboard is intentionally labelled as a demo workspace until authentication and database CRUD are connected. Setting Supabase URL/key alone does **not** switch the local demo data to live mode yet.

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
- Unknown/opted-out consent records are excluded by the sample demo.
- Call scoring is a review aid, not a finding of employee misconduct. Human review is required for low confidence or conflicting evidence.
- Phone encryption/HMAC creation, webhook signature verification, idempotent dispatch, consent re-checks at dispatch time and audit transcript evidence must be implemented before production.
- The live Supabase security advisor reported warnings on authenticated execution of two `SECURITY DEFINER` membership helper functions. These are used by RLS policies; move the helpers to a non-exposed schema or otherwise remediate and re-run the advisor before production. Do not treat the current security review as fully cleared.

## Next production gates

1. Implement Supabase OTP login, organization bootstrap/invites and session handling; the API currently expects a valid Supabase bearer token.
2. Replace localStorage data in the dashboard with authenticated tenant-scoped API calls and CRUD.
3. Implement validated XLSX/CSV import with duplicate detection and import error report.
4. Implement approved knowledge ingestion (source upload, structured claims, version approval and retrieval).
5. Persist sampling batches, seed and selected participant IDs; enforce sample approval and eligibility server-side.
6. Select telephony vendor, confirm account/API access and applicable Indian calling/consent compliance. Implement provider callbacks and WebSocket audio in `voice-worker`.
7. Implement STT/LLM/TTS conversation state, Hindi/Bhojpuri handling, source-grounded assessment and human review queue.
8. Add tests, secrets management, rate limits, monitoring, data retention policy and backup/restore validation.
9. Connect a dedicated GitHub repository and Vercel project after account permissions allow it. No unrelated repository has been modified and no deployment has been claimed.

## Environment variables

See `apps/web/.env.example` for the browser URL and publishable key, and `apps/api/.env.example` for the API URL, publishable key and allowed web origin. Never put a service-role key in the browser app or expose it through a `NEXT_PUBLIC_*` variable. The API has no service-role credential configured.

## Activity API

- `GET /v1/activities` accepts an optional `orgId` UUID and returns at most 500 rows visible to the authenticated user through RLS.
- `POST /v1/activities` accepts `orgId`, `staffRef`, `village`, `activityDate`, `productSku`, `reportedFarmerCount` and an optional `externalRef`. Only organization owners, admins and auditors may create records. Product SKU and reported farmer count are currently stored in activity metadata; product/farmer mapping and bulk import are not implemented in this API.
- Requests require `Authorization: Bearer <Supabase access token>`. The web demo does not yet authenticate users or call these endpoints.

