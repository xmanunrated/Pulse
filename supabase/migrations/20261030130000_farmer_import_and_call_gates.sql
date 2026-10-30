-- Farmer contact data stays encrypted; HMACs are used only for duplicate detection.
alter table public.faa_farmers
  add column if not exists do_not_call boolean not null default false,
  add column if not exists opted_out_at timestamptz,
  add column if not exists opt_out_source text;

alter table public.faa_activity_participants
  add column if not exists consent_method text,
  add column if not exists consent_evidence_ref text,
  add column if not exists recording_consent_at timestamptz,
  add column if not exists recording_consent_evidence_ref text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'faa_farmers_opt_out_metadata_check'
      and conrelid = 'public.faa_farmers'::regclass
  ) then
    alter table public.faa_farmers
      add constraint faa_farmers_opt_out_metadata_check
      check ((not do_not_call and opted_out_at is null and opt_out_source is null)
        or (do_not_call and opted_out_at is not null and opt_out_source is not null)) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'faa_participants_consent_evidence_check'
      and conrelid = 'public.faa_activity_participants'::regclass
  ) then
    alter table public.faa_activity_participants
      add constraint faa_participants_consent_evidence_check
      check (consent_status <> 'eligible' or (
        consent_method is not null
        and
        consent_method in ('verbal', 'written', 'digital', 'partner_attestation')
        and nullif(trim(consent_source), '') is not null
        and nullif(trim(consent_purpose), '') is not null
        and consent_at is not null
        and nullif(trim(consent_evidence_ref), '') is not null
      )) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'faa_participants_recording_evidence_check'
      and conrelid = 'public.faa_activity_participants'::regclass
  ) then
    alter table public.faa_activity_participants
      add constraint faa_participants_recording_evidence_check
      check (recording_consent_status <> 'granted' or (
        recording_consent_at is not null
        and nullif(trim(recording_consent_evidence_ref), '') is not null
      )) not valid;
  end if;
end $$;

create index if not exists faa_farmers_opted_out_idx
  on public.faa_farmers (org_id, id) where do_not_call;
create index if not exists faa_participants_sample_eligibility_idx
  on public.faa_activity_participants (org_id, activity_id, product_id, consent_status);
