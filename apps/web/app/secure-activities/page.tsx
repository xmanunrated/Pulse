'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import type { Session } from '@supabase/supabase-js';
import { createSupabaseBrowserClient } from '../../lib/supabase';

type Organization = { id: string; name: string; role: string };
type Activity = {
  id: string;
  org_id: string;
  staff_ref: string;
  village: string;
  activity_date: string;
  status: string;
  metadata: Record<string, unknown> | null;
};

const API_URL = process.env.NEXT_PUBLIC_FAA_API_URL?.replace(/\/+$/, '') ?? '/v1';
const WRITER_ROLES = new Set(['owner', 'admin', 'auditor']);

export default function SecureActivitiesPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [email, setEmail] = useState('');
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationId] = useState('');
  const [activities, setActivities] = useState<Activity[]>([]);
  const [activityDate, setActivityDate] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const activityRequestId = useRef(0);

  const apiRequest = useCallback(async (path: string, accessToken: string, init?: RequestInit) => {
    const response = await fetch(`${API_URL}${path}`, {
      ...init,
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...(init?.headers ?? {}),
      },
    });
    if (!response.ok) throw new Error(response.status === 401
      ? 'Your sign-in has expired. Sign in again to continue.'
      : response.status === 403
        ? 'Your organization role does not allow that action.'
        : 'The secure activity service could not complete the request.');
    return response.json();
  }, []);

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true);
      return;
    }

    let mounted = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      setAuthReady(true);
    });

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      if (error) setMessage('Could not restore your sign-in session. Please sign in again.');
      setSession(data.session);
      setAuthReady(true);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (!session?.access_token || !API_URL) {
      setOrganizations([]);
      setOrganizationId('');
      setActivities([]);
      return;
    }

    let mounted = true;
    setLoading(true);
    void apiRequest('/organizations', session.access_token)
      .then((result: { data: Organization[] }) => {
        if (!mounted) return;
        const nextOrganizations = result.data ?? [];
        setOrganizations(nextOrganizations);
        setMessage('');
        setOrganizationId((current) => nextOrganizations.some((organization) => organization.id === current)
          ? current
          : nextOrganizations[0]?.id ?? '');
      })
      .catch((error: Error) => {
        if (mounted) setMessage(error.message);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => { mounted = false; };
  }, [apiRequest, session?.access_token]);

  const loadActivities = useCallback(async (orgId: string) => {
    if (!session?.access_token || !orgId) return;
    const requestId = ++activityRequestId.current;
    setLoading(true);
    try {
      const result = await apiRequest(`/activities?orgId=${encodeURIComponent(orgId)}`, session.access_token);
      if (requestId !== activityRequestId.current) return;
      setActivities(result.data ?? []);
      setMessage('');
    } catch (error) {
      if (requestId !== activityRequestId.current) return;
      setMessage(error instanceof Error ? error.message : 'Could not load activities.');
      setActivities([]);
    } finally {
      if (requestId === activityRequestId.current) setLoading(false);
    }
  }, [apiRequest, session?.access_token]);

  useEffect(() => {
    if (organizationId) void loadActivities(organizationId);
    else setActivities([]);
    return () => { activityRequestId.current += 1; };
  }, [loadActivities, organizationId]);

  async function requestSignInLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setMessage('');
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          shouldCreateUser: false,
          emailRedirectTo: `${window.location.origin}/secure-activities`,
        },
      });
      setMessage(error
        ? 'Could not send a sign-in link. Check the address and authentication settings.'
        : 'If this account is registered, a sign-in link has been sent. Check your email.');
    } catch {
      setMessage('Could not send a sign-in link. Check the address and authentication settings.');
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    if (!supabase) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.signOut();
      if (!error) {
        setSession(null);
        setOrganizations([]);
        setOrganizationId('');
        setActivities([]);
      }
      setMessage(error ? 'Could not sign out. Please retry.' : 'You are signed out.');
    } catch {
      setMessage('Could not sign out. Please retry.');
    } finally {
      setBusy(false);
    }
  }

  async function createActivity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session?.access_token || !organizationId) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setMessage('');
    try {
      const result = await apiRequest('/activities', session.access_token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: organizationId,
          staffRef: String(values.get('staffRef') ?? '').trim(),
          village: String(values.get('village') ?? '').trim(),
          activityDate: String(values.get('activityDate') ?? ''),
          productSku: String(values.get('productSku') ?? '').trim(),
          reportedFarmerCount: Number(values.get('reportedFarmerCount')),
          externalRef: String(values.get('externalRef') ?? '').trim() || undefined,
        }),
      });
      setActivities((current) => [result.data, ...current]);
      form.reset();
      setActivityDate('');
      setMessage('Activity saved. No farmer contact was initiated.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save activity.');
    } finally {
      setBusy(false);
    }
  }

  const selectedOrganization = organizations.find((organization) => organization.id === organizationId);
  const canCreate = selectedOrganization && WRITER_ROLES.has(selectedOrganization.role);

  return (
    <main className="page-wrap" style={{ maxWidth: 1120 }}>
      <header className="page-title-row">
        <div>
          <div className="eyebrow">FIELDLENS AI · AUTHENTICATED PROTOTYPE</div>
          <h1>Secure activity records</h1>
          <p className="subtitle">Organization-scoped activity data. This page does not schedule or place calls.</p>
        </div>
        <Link className="btn secondary" href="/">Back to demo dashboard</Link>
      </header>

      {(!supabase || !API_URL) && (
        <section className="card" style={{ padding: 20, marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Setup required</h2>
          <p className="subtitle">Set the Supabase URL and publishable key in the web environment, then restart the app.</p>
        </section>
      )}

      {!authReady ? (
        <section className="card empty-state">Checking your sign-in session…</section>
      ) : !session ? (
        <section className="card" style={{ maxWidth: 520, padding: 22 }}>
          <div className="card-head">
            <div><h2>Sign in to your workspace</h2><p>Only existing accounts can request a sign-in link.</p></div>
          </div>
          <form className="form" onSubmit={requestSignInLink}>
            <label>Email address
              <input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <button className="btn primary" disabled={busy || !supabase || !API_URL} type="submit">
              {busy ? 'Sending…' : 'Send sign-in link'}
            </button>
          </form>
          <p className="subtitle" style={{ marginTop: 14 }}>Your account must already have an organization membership. Ask the workspace admin for access.</p>
        </section>
      ) : (
        <>
          <section className="card" style={{ padding: 16, marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <strong>Signed in</strong>
              <div className="subtitle">{session.user.email ?? 'Authenticated account'}</div>
            </div>
            <button className="btn secondary" disabled={busy} onClick={() => void signOut()} type="button">Sign out</button>
          </section>

          {organizations.length > 0 && (
            <section className="card" style={{ padding: 16, marginBottom: 16 }}>
              <label className="form" style={{ maxWidth: 460 }}>Organization
                <select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)}>
                  {organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name} · {organization.role}</option>)}
                </select>
              </label>
            </section>
          )}

          {canCreate && (
            <section className="card" style={{ padding: 20, marginBottom: 16 }}>
              <div className="card-head"><div><h2>Add a field activity</h2><p>Only activity metadata is collected here.</p></div></div>
              <form className="form" onSubmit={createActivity}>
                <div className="form-grid">
                  <label>Staff reference<input name="staffRef" required maxLength={120} /></label>
                  <label>Village<input name="village" required maxLength={120} /></label>
                  <label>Activity date<input name="activityDate" type="date" required value={activityDate} onChange={(event) => setActivityDate(event.target.value)} /></label>
                  <label>Product SKU<input name="productSku" required maxLength={80} /></label>
                  <label>Reported farmer count<input name="reportedFarmerCount" type="number" min="1" max="100000" step="1" required /></label>
                  <label>External reference (optional)<input name="externalRef" maxLength={100} /></label>
                </div>
                <div className="form-actions"><button className="btn primary" disabled={busy} type="submit">{busy ? 'Saving…' : 'Save activity'}</button></div>
              </form>
            </section>
          )}

          {organizations.length === 0 && !loading ? (
            <section className="card empty-state">No organization membership was found for this account. Ask an administrator to grant workspace access.</section>
          ) : (
            <section className="card table-card">
              <div className="card-head" style={{ padding: '18px 18px 0' }}><div><h2>Recent activities</h2><p>Rows returned under your organization membership and RLS policies.</p></div></div>
              {loading ? <div className="empty-state">Loading protected activity data…</div> : activities.length === 0 ? <div className="empty-state">No activities are available for this organization.</div> : (
                <div className="table-scroll"><table><thead><tr><th>Date</th><th>Staff</th><th>Village</th><th>Product</th><th>Reported farmers</th><th>Status</th></tr></thead><tbody>
                  {activities.map((activity) => <tr key={activity.id}>
                    <td>{activity.activity_date}</td><td>{activity.staff_ref}</td><td>{activity.village}</td>
                    <td>{String(activity.metadata?.product_sku ?? '—')}</td>
                    <td>{String(activity.metadata?.reported_farmer_count ?? '—')}</td><td>{activity.status}</td>
                  </tr>)}
                </tbody></table></div>
              )}
            </section>
          )}
        </>
      )}

      {message && <p role="status" aria-live="polite" className="info-banner" style={{ marginTop: 16 }}>{message}</p>}
    </main>
  );
}

