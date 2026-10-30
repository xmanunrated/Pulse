'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import type { Session } from '@supabase/supabase-js';
import { createSupabaseBrowserClient } from '../../lib/supabase';

type Organization = { id: string; name: string; role: string };
type Activity = { id: string; staff_ref: string; village: string; activity_date: string; status: string; metadata: Record<string, unknown> | null };
type Product = { id: string; sku: string; name: string; category: string | null };
type Knowledge = { id: string; product_id: string; version: number; language: string; status: string; source_refs: Array<{ url: string; label?: string | null }> };
type Farmer = { participantId: string; farmerId: string; consentStatus: string; consentMethod: string | null; hasConsentEvidence: boolean; farmer: { name: string | null; village: string | null; language: string; doNotCall: boolean } | null };
type Batch = { id: string; activity_id: string; sample_size: number; status: string; callsCount: number; dispatchEnabled: boolean; created_at: string };
type Tab = 'farmers' | 'knowledge' | 'calls';

const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'farmers', label: 'Farmer list' },
  { id: 'knowledge', label: 'Product knowledge' },
  { id: 'calls', label: 'Call batches' },
];

export default function SecureWorkspacePage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [email, setEmail] = useState('');
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [orgId, setOrgId] = useState('');
  const [activities, setActivities] = useState<Activity[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [knowledge, setKnowledge] = useState<Knowledge[]>([]);
  const [farmers, setFarmers] = useState<Farmer[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [activityId, setActivityId] = useState('');
  const [productId, setProductId] = useState('');
  const [knowledgeVersionId, setKnowledgeVersionId] = useState('');
  const [tab, setTab] = useState<Tab>('farmers');
  const [sampleSize, setSampleSize] = useState('10');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  const apiRequest = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    if (!session?.access_token) throw new Error('Sign in again to continue.');
    const response = await fetch(`/v1${path}`, {
      ...init,
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        ...(init?.headers ?? {}),
      },
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const rowErrors = Array.isArray(result.errors) ? ` ${result.errors.slice(0, 5).map((item: { line: number; code: string }) => `Row ${item.line}: ${item.code}`).join('; ')}` : '';
      throw new Error(`${result.message ?? 'The secure service could not complete the request.'}${rowErrors}`);
    }
    return result as T;
  }, [session?.access_token]);

  useEffect(() => {
    if (!supabase) { setAuthReady(true); return; }
    let mounted = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      setAuthReady(true);
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setAuthReady(true);
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, [supabase]);

  useEffect(() => {
    if (!session?.access_token) { setOrganizations([]); setOrgId(''); return; }
    let active = true;
    void apiRequest<{ data: Organization[] }>('/organizations').then((result) => {
      if (!active) return;
      setOrganizations(result.data ?? []);
      setOrgId((current) => result.data?.some((item) => item.id === current) ? current : result.data?.[0]?.id ?? '');
    }).catch((error: Error) => setNotice(error.message));
    return () => { active = false; };
  }, [apiRequest, session?.access_token]);

  const refreshWorkspace = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [activityResult, productResult, knowledgeResult, batchResult] = await Promise.all([
        apiRequest<{ data: Activity[] }>(`/activities?orgId=${encodeURIComponent(orgId)}`),
        apiRequest<{ data: Product[] }>(`/products?orgId=${encodeURIComponent(orgId)}`),
        apiRequest<{ data: Knowledge[] }>(`/knowledge?orgId=${encodeURIComponent(orgId)}`),
        apiRequest<{ data: Batch[] }>(`/call-batches?orgId=${encodeURIComponent(orgId)}`),
      ]);
      setActivities(activityResult.data ?? []);
      setProducts(productResult.data ?? []);
      setKnowledge(knowledgeResult.data ?? []);
      setBatches(batchResult.data ?? []);
      setActivityId((current) => activityResult.data?.some((item) => item.id === current) ? current : activityResult.data?.[0]?.id ?? '');
      setProductId((current) => productResult.data?.some((item) => item.id === current) ? current : productResult.data?.[0]?.id ?? '');
      setNotice('');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not load this workspace.');
    } finally {
      setLoading(false);
    }
  }, [apiRequest, orgId]);

  useEffect(() => { void refreshWorkspace(); }, [refreshWorkspace]);

  useEffect(() => {
    if (!orgId || !activityId || !productId) { setFarmers([]); return; }
    let active = true;
    void apiRequest<{ data: Farmer[] }>(`/farmers?orgId=${encodeURIComponent(orgId)}&activityId=${encodeURIComponent(activityId)}&productId=${encodeURIComponent(productId)}`)
      .then((result) => { if (active) setFarmers(result.data ?? []); })
      .catch((error: Error) => { if (active) setNotice(error.message); });
    return () => { active = false; };
  }, [apiRequest, orgId, activityId, productId]);

  async function requestSignInLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setNotice('');
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/secure-workspace` },
      });
      setNotice(error ? 'Could not send a sign-in link. Check the address and authentication settings.' : 'If this account is registered, a sign-in link has been sent.');
    } catch {
      setNotice('Could not send a sign-in link. Check the address and authentication settings.');
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    if (!supabase) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.signOut();
      setNotice(error ? 'Could not sign out. Please retry.' : 'You are signed out.');
    } catch {
      setNotice('Could not sign out. Please retry.');
    } finally {
      setBusy(false);
    }
  }

  function downloadCsvTemplate() {
    const headers = [
      'full_name', 'external_ref', 'phone', 'village', 'district', 'state', 'preferred_language',
      'consent_status', 'consent_method', 'consent_source', 'consent_purpose', 'consent_at',
      'consent_evidence_ref', 'recording_consent_status', 'recording_consent_at',
      'recording_consent_evidence_ref',
    ];
    const blob = new Blob([`${headers.join(',')}\r\n`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'fieldlens-farmer-import-template.csv';
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importFarmers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!orgId || !activityId || !productId) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    form.set('orgId', orgId);
    form.set('activityId', activityId);
    form.set('productId', productId);
    setBusy(true);
    try {
      const result = await apiRequest<{ summary: { imported: number; eligible: number; unknown: number; suppressed: number }; message: string }>('/farmers/import', { method: 'POST', body: form });
      setNotice(`${result.message} ${result.summary.imported} imported; ${result.summary.eligible} eligible; ${result.summary.unknown} unknown; ${result.summary.suppressed} suppressed.`);
      await refreshWorkspace();
      const updated = await apiRequest<{ data: Farmer[] }>(`/farmers?orgId=${encodeURIComponent(orgId)}&activityId=${encodeURIComponent(activityId)}&productId=${encodeURIComponent(productId)}`);
      setFarmers(updated.data ?? []);
      formElement.reset();
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not import farmers.'); }
    finally { setBusy(false); }
  }

  async function createProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    try {
      const result = await apiRequest<{ data: Product }>('/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orgId, sku: form.get('sku'), name: form.get('name'), category: form.get('category') || undefined }) });
      formElement.reset();
      await refreshWorkspace();
      setProductId(result.data.id);
      setNotice('Product created. Add source-backed claims before using it in a call batch.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not create product.'); }
    finally { setBusy(false); }
  }

  async function createKnowledge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    try {
      await apiRequest('/knowledge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orgId, productId, language: form.get('language'), claims: [{ text: form.get('claim'), sourceUrl: form.get('sourceUrl'), sourceLabel: form.get('sourceLabel') || undefined }] }) });
      formElement.reset();
      await refreshWorkspace();
      setNotice('Knowledge saved as a draft. A reviewer must approve it before sampling.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not save the knowledge draft.'); }
    finally { setBusy(false); }
  }

  async function approveKnowledge(versionId: string) {
    setBusy(true);
    try {
      await apiRequest(`/knowledge/${versionId}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orgId }) });
      await refreshWorkspace();
      setNotice('Knowledge version approved.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not approve this version.'); }
    finally { setBusy(false); }
  }

  async function markOptOut(farmerId: string) {
    if (!window.confirm('Record this farmer as opted out and cancel queued calls for this organization?')) return;
    setBusy(true);
    try {
      await apiRequest(`/farmers/${farmerId}/opt-out`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orgId, source: 'workspace_operator' }) });
      const updated = await apiRequest<{ data: Farmer[] }>(`/farmers?orgId=${encodeURIComponent(orgId)}&activityId=${encodeURIComponent(activityId)}&productId=${encodeURIComponent(productId)}`);
      setFarmers(updated.data ?? []);
      setNotice('Opt-out recorded and queued calls cancelled.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not record the opt-out.'); }
    finally { setBusy(false); }
  }

  async function prepareBatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!knowledgeVersionId) { setNotice('Approve source-backed product knowledge before sampling.'); return; }
    setBusy(true);
    try {
      const result = await apiRequest<{ message: string }>('/call-batches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orgId, activityId, productId, knowledgeVersionId, sampleSize: Number(sampleSize) }) });
      await refreshWorkspace();
      setNotice(result.message);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not prepare a call batch.'); }
    finally { setBusy(false); }
  }

  async function approveBatch(batchId: string) {
    setBusy(true);
    try {
      const result = await apiRequest<{ message: string }>(`/call-batches/${batchId}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orgId }) });
      await refreshWorkspace();
      setNotice(result.message);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not approve this batch.'); }
    finally { setBusy(false); }
  }

  async function requestDispatch(batchId: string) {
    setBusy(true);
    try {
      await apiRequest(`/call-batches/${batchId}/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orgId }) });
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Dispatch is disabled. No calls were placed.'); }
    finally { setBusy(false); }
  }

  if (!authReady) return <main className="page-wrap"><section className="card empty-state">Checking your sign-in session…</section></main>;
  if (!session) return (
    <main className="page-wrap" style={{ maxWidth: 700 }}>
      <header className="page-title-row"><div><div className="eyebrow">FIELDLENS AI · SECURE WORKSPACE</div><h1>Upload and prepare audits</h1><p className="subtitle">Sign in with an existing workspace account. This prototype never starts live calls.</p></div><Link className="btn secondary" href="/">Back to demo</Link></header>
      <section className="card" style={{ maxWidth: 520, padding: 22 }}>
        <form className="form" onSubmit={requestSignInLink}>
          <label>Email address<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <button className="btn primary" disabled={busy || !supabase} type="submit">{busy ? 'Sending…' : 'Send sign-in link'}</button>
        </form>
        <p className="subtitle" style={{ marginTop: 12 }}>Only existing accounts can request a link. The account must have an organization membership.</p>
      </section>
      {notice && <p role="status" className="info-banner">{notice}</p>}
    </main>
  );

  return (
    <main className="page-wrap" style={{ maxWidth: 1180 }}>
      <header className="page-title-row">
        <div><div className="eyebrow">FIELDLENS AI · AUTHENTICATED PROTOTYPE</div><h1>Audit operations</h1><p className="subtitle">Upload consent records, maintain approved product facts, and prepare a reviewable call sample.</p></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button className="btn secondary" type="button" onClick={() => void signOut()} disabled={busy}>Sign out</button><Link className="btn secondary" href="/secure-activities">Secure activity records</Link><Link className="btn secondary" href="/">Demo dashboard</Link></div>
      </header>

      <section className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: 16, marginBottom: 16 }}>
        <div><strong>{session.user.email ?? 'Signed-in account'}</strong><p className="subtitle" style={{ margin: '4px 0 0' }}>Organization data is filtered by your Supabase membership.</p></div>
        <label>Organization<select value={orgId} onChange={(event) => setOrgId(event.target.value)} disabled={!organizations.length}>{organizations.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.role}</option>)}</select></label>
      </section>

      <section className="info-banner" style={{ marginBottom: 16 }}><strong>Live calling is disabled.</strong>&nbsp; Draft batches do not dial. The provider account, India telecom onboarding, consent checks and dispatch worker still need completion.</section>

      {organizations.length === 0 && !loading ? <section className="card empty-state">No organization membership was found for this account. Ask an organization owner to provision access.</section> : <>
        <nav aria-label="Audit operations" className="toolbar-right" style={{ marginBottom: 16 }}>{tabs.map((item) => <button key={item.id} type="button" className={`btn ${tab === item.id ? 'primary' : 'secondary'}`} onClick={() => setTab(item.id)}>{item.label}</button>)}</nav>

        {tab === 'farmers' && <>
          <section className="card" style={{ padding: 20, marginBottom: 16 }}>
            <div className="card-head"><div><h2>Import farmer list</h2><p>CSV is encrypted and deduplicated on the server. Phone values are never returned to this page.</p></div></div>
            {!products.length && <form className="form" onSubmit={createProduct}>
              <p className="subtitle">Create the first product before importing participants.</p>
              <div className="form-grid"><label>Product SKU<input name="sku" required maxLength={80} pattern="[A-Za-z0-9._-]+" /></label><label>Product name<input name="name" required maxLength={160} /></label><label>Category<input name="category" maxLength={120} /></label></div>
              <button className="btn primary" disabled={busy || !orgId}>Create product</button>
            </form>}
            <form className="form" onSubmit={importFarmers}>
              <div className="form-grid">
                <label>Field activity<select required value={activityId} onChange={(event) => setActivityId(event.target.value)}><option value="">Select an activity</option>{activities.map((item) => <option key={item.id} value={item.id}>{item.staff_ref} · {item.village} · {item.activity_date}</option>)}</select></label>
                <label>Product<select required value={productId} onChange={(event) => setProductId(event.target.value)}><option value="">Select a product</option>{products.map((item) => <option key={item.id} value={item.id}>{item.sku} · {item.name}</option>)}</select></label>
                <label>Farmer CSV<input name="file" type="file" accept=".csv,text/csv" required /></label>
              </div>
              <p className="subtitle">CSV limit: 4 MB and 5,000 farmers. Required columns: <code>phone</code>, <code>village</code>. To mark consent eligible, include method, source, purpose, ISO timestamp with timezone, and evidence reference. Unknown and opted-out rows cannot enter a call sample. Use documented, purpose-specific permission; never infer consent from meeting attendance.</p>
              <button className="btn secondary small-btn" type="button" onClick={downloadCsvTemplate}>Download CSV template</button>
              <button className="btn primary" type="submit" disabled={busy || !activityId || !productId}>{busy ? 'Importing…' : 'Import farmer list'}</button>
            </form>
          </section>
          <section className="card table-card">
            <div className="card-head"><div><h2>Eligibility register</h2><p>{farmers.length} records · no phone numbers displayed</p></div><button className="btn secondary small-btn" type="button" onClick={() => void refreshWorkspace()} disabled={loading}>Refresh</button></div>
            {loading ? <div className="empty-state">Loading farmer records…</div> : !farmers.length ? <div className="empty-state">Select an activity and product. Import records to build the eligibility register.</div> : <div className="table-scroll"><table><thead><tr><th>Farmer</th><th>Village</th><th>Language</th><th>Consent</th><th>Evidence</th><th>Opt-out</th></tr></thead><tbody>{farmers.map((item) => <tr key={item.participantId}><td>{item.farmer?.name ?? item.farmerId.slice(0, 8)}</td><td>{item.farmer?.village ?? '—'}</td><td>{item.farmer?.language ?? '—'}</td><td>{item.consentStatus}</td><td>{item.hasConsentEvidence ? 'Recorded' : 'Missing'}</td><td>{item.farmer?.doNotCall ? 'Suppressed' : <button className="btn secondary small-btn" type="button" disabled={busy} onClick={() => void markOptOut(item.farmerId)}>Mark opted out</button>}</td></tr>)}</tbody></table></div>}
          </section>
        </>}

        {tab === 'knowledge' && <>
          <section className="card" style={{ padding: 20, marginBottom: 16 }}>
            <div className="card-head"><div><h2>Add a product</h2><p>Products are organization-scoped and start without approved knowledge.</p></div></div>
            <form className="form" onSubmit={createProduct}>
              <div className="form-grid"><label>Product SKU<input name="sku" required maxLength={80} pattern="[A-Za-z0-9._-]+" /></label><label>Product name<input name="name" required maxLength={160} /></label><label>Category<input name="category" maxLength={120} /></label></div>
              <button className="btn secondary" disabled={busy || !orgId}>Create product</button>
            </form>
          </section>
          <section className="card" style={{ padding: 20, marginBottom: 16 }}>
            <div className="card-head"><div><h2>Add a source-backed knowledge version</h2><p>Each claim starts as a draft. Review and approval are separate from data entry.</p></div></div>
            <form className="form" onSubmit={createKnowledge}>
              <div className="form-grid"><label>Product<select required value={productId} onChange={(event) => { setProductId(event.target.value); setKnowledgeVersionId(''); }}><option value="">Select a product</option>{products.map((item) => <option key={item.id} value={item.id}>{item.sku} · {item.name}</option>)}</select></label><label>Language<select name="language" defaultValue="hi"><option value="hi">Hindi</option><option value="bho">Bhojpuri</option><option value="en">English</option></select></label><label>Source label<input name="sourceLabel" maxLength={160} placeholder="Approved product label or document" /></label></div>
              <label>Verified product claim<textarea name="claim" required maxLength={1200} rows={4} placeholder="Write one factual claim that can be checked against the source." /></label>
              <label>HTTPS source URL<input name="sourceUrl" type="url" required pattern="https://.*" placeholder="https://example.com/product-document" /></label>
              <button className="btn primary" disabled={busy || !productId}>Save draft version</button>
            </form>
          </section>
          <section className="card table-card"><div className="card-head"><div><h2>Knowledge versions</h2><p>Only approved, source-backed versions can be selected for a sample.</p></div></div>{!knowledge.length ? <div className="empty-state">No knowledge versions yet.</div> : <div className="table-scroll"><table><thead><tr><th>Product</th><th>Version</th><th>Language</th><th>Status</th><th>Sources</th><th>Review</th></tr></thead><tbody>{knowledge.map((item) => <tr key={item.id}><td>{products.find((product) => product.id === item.product_id)?.sku ?? item.product_id.slice(0, 8)}</td><td>v{item.version}</td><td>{item.language}</td><td>{item.status}</td><td>{item.source_refs?.length ?? 0}</td><td>{item.status === 'draft' ? <button className="btn secondary small-btn" type="button" disabled={busy} onClick={() => void approveKnowledge(item.id)}>Approve version</button> : item.status === 'approved' ? 'Ready for sampling' : '—'}</td></tr>)}</tbody></table></div>}</section>
        </>}

        {tab === 'calls' && <>
          <section className="card" style={{ padding: 20, marginBottom: 16 }}>
            <div className="card-head"><div><h2>Prepare a reviewable sample</h2><p>Consent and approved knowledge are rechecked before approval. No calls are placed by these actions.</p></div></div>
            <form className="form" onSubmit={prepareBatch}>
              <div className="form-grid"><label>Field activity<select required value={activityId} onChange={(event) => setActivityId(event.target.value)}><option value="">Select an activity</option>{activities.map((item) => <option key={item.id} value={item.id}>{item.staff_ref} · {item.village} · {item.activity_date}</option>)}</select></label><label>Product<select required value={productId} onChange={(event) => { setProductId(event.target.value); setKnowledgeVersionId(''); }}><option value="">Select a product</option>{products.map((item) => <option key={item.id} value={item.id}>{item.sku} · {item.name}</option>)}</select></label><label>Approved knowledge<select required value={knowledgeVersionId} onChange={(event) => setKnowledgeVersionId(event.target.value)}><option value="">Select approved version</option>{knowledge.filter((item) => item.status === 'approved' && item.product_id === productId).map((item) => <option key={item.id} value={item.id}>v{item.version} · {item.language}</option>)}</select></label><label>Sample size<input type="number" min="1" max="100" required value={sampleSize} onChange={(event) => setSampleSize(event.target.value)} /></label></div>
              <button className="btn primary" disabled={busy || !activityId || !productId || !knowledgeVersionId}>Prepare draft sample</button>
            </form>
          </section>
          <section className="card table-card"><div className="card-head"><div><h2>Call batches</h2><p>Drafts and approvals are stored in the audit log; dispatch remains disabled.</p></div></div>{!batches.length ? <div className="empty-state">No call batches prepared.</div> : <div className="table-scroll"><table><thead><tr><th>Batch</th><th>Created</th><th>Sample</th><th>Status</th><th>Action</th></tr></thead><tbody>{batches.map((batch) => <tr key={batch.id}><td>{batch.id.slice(0, 8)}</td><td>{new Date(batch.created_at).toLocaleString()}</td><td>{batch.callsCount}</td><td>{batch.status}</td><td>{batch.status === 'draft' ? <button className="btn secondary small-btn" type="button" disabled={busy} onClick={() => void approveBatch(batch.id)}>Approve sample</button> : batch.status === 'approved' ? <button className="btn secondary small-btn" type="button" disabled={busy} onClick={() => void requestDispatch(batch.id)}>Start calls (disabled)</button> : '—'}</td></tr>)}</tbody></table></div>}</section>
        </>}
      </>}
      {notice && <p role="status" aria-live="polite" className="info-banner" style={{ marginTop: 16 }}>{notice}</p>}
    </main>
  );
}
