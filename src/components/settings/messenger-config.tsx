'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Copy, Eye, EyeOff, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SettingsPanelHead } from './settings-panel-head';

const MASK = '••••••••••••••••';

export function MessengerConfig() {
  const { accountId, loading: authLoading, profileLoading } = useAuth();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [pageName, setPageName] = useState<string | null>(null);
  const [pageIdSaved, setPageIdSaved] = useState<string | null>(null);

  const [pageId, setPageId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [tokenEdited, setTokenEdited] = useState(false);
  const [hasSavedToken, setHasSavedToken] = useState(false);

  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/messenger/webhook`
      : '/api/messenger/webhook';

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const { data } = await supabase
      .from('messenger_config')
      .select('page_id, page_name, access_token, verify_token, status')
      .eq('account_id', accountId)
      .maybeSingle();

    if (data) {
      setPageId(data.page_id || '');
      setPageIdSaved(data.page_id || null);
      setPageName(data.page_name || null);
      setHasSavedToken(Boolean(data.access_token));
      setAccessToken(data.access_token ? MASK : '');
      setTokenEdited(false);
      setConnected(data.status === 'connected');
    } else {
      setConnected(false);
      setPageName(null);
      setPageIdSaved(null);
      setHasSavedToken(false);
    }
    setLoading(false);
  }, [accountId, supabase]);

  useEffect(() => {
    if (authLoading || profileLoading || !accountId) return;
    void load();
  }, [authLoading, profileLoading, accountId, load]);

  async function saveConfig() {
    const tokenToSend = tokenEdited ? accessToken.trim() : '';
    if (!tokenToSend || tokenToSend === MASK) {
      toast.error('Paste your Page Access Token');
      return;
    }
    if (!tokenToSend.startsWith('EAA')) {
      toast.error('Token must be a Page Access Token from Meta Generate (starts with EAA)');
      return;
    }
    if (pageId.includes('@') || pageId === '123456789012345') {
      toast.error('Page ID clear করুন — খালি রাখুন (auto-detect হবে)');
      return;
    }
    if (!verifyToken.trim()) {
      toast.error('Enter a Webhook Verify Token (same one you will use in Meta)');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/messenger/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          page_id: pageId.trim() || undefined,
          access_token: tokenToSend,
          verify_token: verifyToken.trim() || undefined,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || 'Save failed');
        return;
      }
      toast.success(`Connected: ${payload.page_info?.name || 'Facebook Page'}`);
      if (payload.subscribed === false && payload.subscribe_error) {
        toast.error(
          `Saved, but Page webhook subscribe failed: ${payload.subscribe_error}`,
        );
      }
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    try {
      const res = await fetch('/api/messenger/config');
      const payload = await res.json();
      if (payload.connected) {
        const subOk = payload.subscribed !== false;
        toast.success(
          subOk
            ? `OK — ${payload.page_info?.name} (${payload.page_info?.id}) · webhook subscribed`
            : `Token OK — ${payload.page_info?.name}, but Page webhook subscribe failed`,
        );
        if (!subOk && payload.subscribe_error) {
          toast.error(String(payload.subscribe_error));
        }
        setConnected(true);
        setPageName(payload.page_info?.name || null);
      } else {
        toast.error(payload.message || 'Not connected');
        setConnected(false);
      }
    } catch {
      toast.error('Test failed');
    } finally {
      setTesting(false);
    }
  }

  async function handleReset() {
    if (!confirm('Disconnect Facebook Page Messenger from this CRM?')) return;
    const res = await fetch('/api/messenger/config', { method: 'DELETE' });
    if (!res.ok) {
      toast.error('Reset failed');
      return;
    }
    toast.success('Messenger disconnected');
    setPageId('');
    setAccessToken('');
    setVerifyToken('');
    setConnected(false);
    setPageName(null);
    setHasSavedToken(false);
    setTokenEdited(false);
  }

  function copyWebhook() {
    void navigator.clipboard.writeText(webhookUrl);
    toast.success('Webhook URL copied');
  }

  if (loading || authLoading || profileLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground p-6">
        <Loader2 className="size-4 animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SettingsPanelHead
        title="Facebook Messenger"
        description="Connect a Facebook Page so Messenger chats appear in the shared inbox."
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            {connected ? (
              <CheckCircle2 className="size-4 text-emerald-500" />
            ) : (
              <XCircle className="size-4 text-muted-foreground" />
            )}
            {connected ? 'Connected' : 'Not connected'}
          </CardTitle>
          <CardDescription>
            {connected && pageName
              ? `${pageName}${pageIdSaved ? ` · Page ID ${pageIdSaved}` : ''}`
              : 'Paste a Page Access Token from Meta to connect.'}
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">Page credentials</CardTitle>
          <CardDescription>
            Meta App → Messenger → Settings. Use a Page Access Token for your business Page.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Page ID (optional — leave blank)</Label>
            <Input
              value={pageId}
              onChange={(e) => setPageId(e.target.value)}
              placeholder="Leave empty — filled from token"
              autoComplete="off"
              name="messenger-page-id"
              inputMode="numeric"
            />
          </div>
          <div className="space-y-2">
            <Label>Page Access Token</Label>
            <div className="relative">
              <Input
                type={showToken ? 'text' : 'password'}
                value={accessToken}
                onChange={(e) => {
                  setAccessToken(e.target.value);
                  setTokenEdited(true);
                }}
                placeholder="EAA... (from Meta → Generate)"
                autoComplete="new-password"
                name="messenger-page-access-token"
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
            <p className="text-xs text-muted-foreground">
              Meta → Messenger API Settings → your Page → <strong>Generate</strong>, then paste the full token (starts with EAA).
            </p>
          </div>
          <div className="space-y-2">
            <Label>Webhook Verify Token</Label>
            <Input
              value={verifyToken}
              onChange={(e) => setVerifyToken(e.target.value)}
              placeholder="Choose any secret string"
              autoComplete="off"
              name="messenger-verify-token"
            />
            <p className="text-xs text-muted-foreground">
              Must match the Verify Token you enter in Meta webhook settings.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void saveConfig()} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              Save Configuration
            </Button>
            <Button variant="outline" onClick={() => void handleTest()} disabled={testing}>
              {testing ? <Loader2 className="size-4 animate-spin" /> : null}
              Test Connection
            </Button>
            {connected ? (
              <Button variant="destructive" onClick={() => void handleReset()}>
                Disconnect
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">Webhook</CardTitle>
          <CardDescription>
            In Meta → Webhooks, subscribe the <strong>Page</strong> object to{' '}
            <code className="text-xs">messages</code>. Callback URL:
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex gap-2">
            <Input readOnly value={webhookUrl} className="font-mono text-xs" />
            <Button type="button" variant="outline" size="icon" onClick={copyWebhook}>
              <Copy className="size-4" />
            </Button>
          </div>
          <ol className="list-decimal pl-5 text-sm text-muted-foreground space-y-1">
            <li>Create / open your Meta App with Messenger product</li>
            <li>Generate a Page Access Token for your Facebook Page (starts with EAA)</li>
            <li>Add webhook callback URL above + your Verify Token; subscribe field: messages</li>
            <li>Save Configuration (or Test Connection) — CRM also calls Page subscribed_apps</li>
            <li>Send a test message to the Page — it should appear in Inbox → Messenger</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
