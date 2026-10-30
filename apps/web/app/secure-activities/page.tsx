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
          <div className="eyebrow">FIELDLENS AI Â· AUTHEN×û¶‰ËkºwµçH]ˆÛ\ÜÓ˜[YOH˜Ø\™ZXYˆİ[O^ŞÈY[™Îˆ	ÌNN	È_O]”™XÙ[Xİ]š]Y\ÏÚ”›İÜÈ™]\›™Y[™\ˆ[İ\ˆÜ™Ø[š^˜][ÛˆY[X™\œÚ\[™“ÈÛXÚY\ËÜÙ]Ù]‚ˆÛØY[™ÈÈ]ˆÛ\ÜÓ˜[YOH™[\K\İ]H“ØY[™È›İXİYXİ]š]H]x )Ù]ˆˆXİ]š]Y\Ë›[™İOOHÈ]ˆÛ\ÜÓ˜[YOH™[\K\İ]H“›ÈXİ]š]Y\È\™H]˜Z[X›H›Üˆ\ÈÜ™Ø[š^˜][Û‹Ù]ˆˆ
ˆ]ˆÛ\ÜÓ˜[YOHX›K\ØÜ›ÛX›OXY‘]Oİ”İY™İ•š[YÙOİ”›ÙXİİ”™\ÜY˜\›Y\œÏİ”İ]\ÏİİİXY›ÙO‚ˆØXİ]š]Y\Ë›X\

Xİ]š]JHOˆˆÙ^O^ØXİ]š]KšYO‚ˆØXİ]š]K˜Xİ]š]WÙ]_OİØXİ]š]KœİY™—Ü™YŸOİØXİ]š]Kš[YÙ_Oİ‚ˆÔİš[™ÊXİ]š]K›Y]Y]OËœ›ÙXİÜÚİHÏÈ	ø %	Ê_Oİ‚ˆÔİš[™ÊXİ]š]K›Y]Y]OËœ™\ÜYÙ˜\›Y\—ØÛİ[ÏÈ	ø %	Ê_OİØXİ]š]Kœİ]\ßOİ‚ˆİŠ_Bˆİ›ÙOİX›OÙ]‚ˆ
_BˆÜÙXİ[Û‚ˆ
_BˆÏ‚ˆ
_B‚ˆÛY\ÜØYÙH	‰ˆ›ÛOHœİ]\Èˆ\šXK[]™OHœÛ]HˆÛ\ÜÓ˜[YOHš[™›ËX˜[›™\ˆˆİ[O^ŞÈX\™Ú[•ÜˆMˆ_OÛY\ÜØYÙ_OÜŸBˆÛXZ[‚ˆ
NÂŸB