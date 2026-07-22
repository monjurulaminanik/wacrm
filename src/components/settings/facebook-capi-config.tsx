'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Megaphone,
  XCircle,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { SettingsPanelHead } from './settings-panel-head';

const MASK = '••••••••••••••••';

export function FacebookCapiConfig() {
  const t = useTranslations('Settings.facebookAds');
  const { accountId, loading: authLoading, profileLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [configured, setConfigured] = useState(false);

  const [enabled, setEnabled] = useState(false);
  const [pixelId, setPixelId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [tokenEdited, setTokenEdited] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [testEventCode, setTestEventCode] = useState('');
  const [sendLead, setSendLead] = useState(true);
  const [sendQualified, setSendQualified] = useState(true);
  const [wabaId, setWabaId] = useState('');
  const [pageId, setPageId] = useState('');
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/facebook/capi/config', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('loadFailed'));
        return;
      }
      if (!data.configured) {
        setConfigured(false);
        setEnabled(false);
        setPixelId('');
        setAccessToken('');
        setTokenEdited(false);
        setTestEventCode('');
        setLastError(null);
        setLastEventAt(null);
        return;
      }
      setConfigured(true);
      setEnabled(Boolean(data.enabled));
      setPixelId(data.pixel_id || '');
      setAccessToken(data.has_token ? MASK : '');
      setTokenEdited(false);
      setTestEventCode(data.test_event_code || '');
      setSendLead(data.send_lead_on_first_message !== false);
      setSendQualified(data.send_qualified_lead_on_new_contact !== false);
      setWabaId(data.waba_id || '');
      setPageId(data.page_id || '');
      setLastError(data.last_error || null);
      setLastEventAt(data.last_event_at || null);
    } catch {
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (authLoading || profileLoading || !accountId) return;
    void load();
  }, [authLoading, profileLoading, accountId, load]);

  async function saveConfig() {
    if (!pixelId.trim()) {
      toast.error(t('pixelRequired'));
      return;
    }
    const tokenToSend = tokenEdited ? accessToken.trim() : '';
    if (!configured && (!tokenToSend || tokenToSend === MASK)) {
      toast.error(t('tokenRequired'));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/facebook/capi/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pixel_id: pixelId.trim(),
          access_token: tokenToSend && tokenToSend !== MASK ? tokenToSend : undefined,
          test_event_code: testEventCode.trim() || null,
          enabled,
          send_lead_on_first_message: sendLead,
          send_qualified_lead_on_new_contact: sendQualified,
          waba_id: wabaId.trim() || null,
          page_id: pageId.trim() || null,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || t('saveFailed'));
        return;
      }
      toast.success(t('saved'));
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    try {
      const res = await fetch('/api/facebook/capi/config', { method: 'PUT' });
      const payload = await res.json();
      if (!res.ok) {
        toast.error(payload.error || t('testFailed'));
        return;
      }
      if (payload.ok) {
        toast.success(t('testOk'));
        await load();
      } else {
        toast.error(payload.error || t('testFailed'));
        await load();
      }
    } catch {
      toast.error(t('testFailed'));
    } finally {
      setTesting(false);
    }
  }

  async function handleReset() {
    if (!confirm(t('disconnectConfirm'))) return;
    const res = await fetch('/api/facebook/capi/config', { method: 'DELETE' });
    if (!res.ok) {
      toast.error(t('resetFailed'));
      return;
    }
    toast.success(t('disconnected'));
    await load();
  }

  if (loading || authLoading || profileLoading) {
    return (
      <div className="flex items-center gap-2 p-6 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> {t('loading')}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SettingsPanelHead title={t('title')} description={t('description')} />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            {configured && enabled ? (
              <CheckCircle2 className="size-4 text-emerald-500" />
            ) : (
              <XCircle className="size-4 text-muted-foreground" />
            )}
            {configured && enabled ? t('statusEnabled') : t('statusDisabled')}
          </CardTitle>
          <CardDescription>
            {lastEventAt
              ? t('lastEvent', {
                  date: new Date(lastEventAt).toLocaleString(),
                })
              : t('noEventsYet')}
            {lastError ? (
              <span className="mt-1 block text-red-400">{lastError}</span>
            ) : null}
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Megaphone className="size-4 text-primary" />
            {t('credentialsTitle')}
          </CardTitle>
          <CardDescription>{t('credentialsDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
            <div>
              <Label className="text-foreground">{t('enableLabel')}</Label>
              <p className="text-xs text-muted-foreground">{t('enableHint')}</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <div className="space-y-2">
            <Label>{t('pixelLabel')}</Label>
            <Input
              value={pixelId}
              onChange={(e) => setPixelId(e.target.value)}
              placeholder={t('pixelPlaceholder')}
              autoComplete="off"
              name="fb-pixel-id"
              inputMode="numeric"
            />
            <p className="text-xs text-muted-foreground">{t('pixelHint')}</p>
          </div>

          <div className="space-y-2">
            <Label>{t('tokenLabel')}</Label>
            <div className="relative">
              <Input
                type={showToken ? 'text' : 'password'}
                value={accessToken}
                onChange={(e) => {
                  setAccessToken(e.target.value);
                  setTokenEdited(true);
                }}
                placeholder={t('tokenPlaceholder')}
                autoComplete="new-password"
                name="fb-capi-token"
                spellCheck={false}
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                onClick={() => setShowToken((v) => !v)}
              >
                {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">{t('tokenHint')}</p>
          </div>

          <div className="space-y-2">
            <Label>{t('testCodeLabel')}</Label>
            <Input
              value={testEventCode}
              onChange={(e) => setTestEventCode(e.target.value)}
              placeholder={t('testCodePlaceholder')}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">{t('testCodeHint')}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t('wabaLabel')}</Label>
              <Input
                value={wabaId}
                onChange={(e) => setWabaId(e.target.value)}
                placeholder={t('wabaPlaceholder')}
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label>{t('pageLabel')}</Label>
              <Input
                value={pageId}
                onChange={(e) => setPageId(e.target.value)}
                placeholder={t('pagePlaceholder')}
                autoComplete="off"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t('idsHint')}</p>

          <div className="space-y-3 rounded-lg border border-border p-3">
            <p className="text-sm font-medium text-foreground">{t('eventsTitle')}</p>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm">{t('eventLead')}</p>
                <p className="text-xs text-muted-foreground">{t('eventLeadHint')}</p>
              </div>
              <Switch checked={sendLead} onCheckedChange={setSendLead} />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm">{t('eventQualified')}</p>
                <p className="text-xs text-muted-foreground">
                  {t('eventQualifiedHint')}
                </p>
              </div>
              <Switch checked={sendQualified} onCheckedChange={setSendQualified} />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void saveConfig()} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              {t('save')}
            </Button>
            <Button
              variant="outline"
              onClick={() => void handleTest()}
              disabled={testing || !configured}
            >
              {testing ? <Loader2 className="size-4 animate-spin" /> : null}
              {t('sendTest')}
            </Button>
            {configured ? (
              <Button variant="destructive" onClick={() => void handleReset()}>
                {t('disconnect')}
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">{t('howtoTitle')}</CardTitle>
          <CardDescription>{t('howtoDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li>{t('howto1')}</li>
            <li>{t('howto2')}</li>
            <li>{t('howto3')}</li>
            <li>{t('howto4')}</li>
            <li>{t('howto5')}</li>
          </ol>
          <p className="mt-4 text-sm text-muted-foreground">{t('audienceNote')}</p>
        </CardContent>
      </Card>
    </div>
  );
}
