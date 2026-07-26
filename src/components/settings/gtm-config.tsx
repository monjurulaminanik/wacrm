'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  CheckCircle2,
  Loader2,
  Tag,
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
import { SettingsPanelHead } from './settings-panel-head';
import {
  DEFAULT_GTM_CONTAINER_ID,
  isValidGtmContainerId,
  normalizeGtmContainerId,
} from '@/lib/gtm';

export function GtmConfig() {
  const t = useTranslations('Settings.gtm');
  const { accountId, loading: authLoading, profileLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connected, setConnected] = useState(false);
  const [containerId, setContainerId] = useState('');
  const [defaultId, setDefaultId] = useState(DEFAULT_GTM_CONTAINER_ID);
  const autoConnectAttempted = useRef(false);

  const load = useCallback(async (): Promise<{
    configured: boolean;
    connected: boolean;
    container_id: string;
    default_container_id: string;
  } | null> => {
    setLoading(true);
    try {
      const res = await fetch('/api/gtm/config', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('loadFailed'));
        return null;
      }
      const def =
        typeof data.default_container_id === 'string' &&
        isValidGtmContainerId(data.default_container_id)
          ? normalizeGtmContainerId(data.default_container_id)
          : DEFAULT_GTM_CONTAINER_ID;
      setDefaultId(def);

      if (!data.configured) {
        setConnected(false);
        setContainerId(def);
        return {
          configured: false,
          connected: false,
          container_id: '',
          default_container_id: def,
        };
      }

      const id = normalizeGtmContainerId(data.container_id || '');
      setContainerId(id);
      setConnected(Boolean(data.connected));
      return {
        configured: true,
        connected: Boolean(data.connected),
        container_id: id,
        default_container_id: def,
      };
    } catch {
      toast.error(t('loadFailed'));
      return null;
    } finally {
      setLoading(false);
    }
  }, [t]);

  const connect = useCallback(
    async (id: string, { silent }: { silent?: boolean } = {}) => {
      const normalized = normalizeGtmContainerId(id);
      if (!normalized || !isValidGtmContainerId(normalized)) {
        toast.error(t('invalidId'));
        return false;
      }
      setSaving(true);
      try {
        const res = await fetch('/api/gtm/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            container_id: normalized,
            enabled: true,
          }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(payload.error || t('saveFailed'));
          return false;
        }
        setContainerId(normalized);
        setConnected(true);
        if (!silent) {
          toast.success(t('connectedToast'), {
            description: normalized,
          });
        }
        return true;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('saveFailed'));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [t],
  );

  useEffect(() => {
    if (authLoading || profileLoading || !accountId) return;
    let cancelled = false;

    (async () => {
      const state = await load();
      if (cancelled || !state) return;

      // Auto-connect once: if nothing saved yet, save the default / env ID
      // and notify the user with a green Connected state.
      if (
        !state.configured &&
        !autoConnectAttempted.current &&
        isValidGtmContainerId(state.default_container_id)
      ) {
        autoConnectAttempted.current = true;
        const ok = await connect(state.default_container_id, { silent: true });
        if (ok && !cancelled) {
          toast.success(t('autoConnectedToast'), {
            description: normalizeGtmContainerId(state.default_container_id),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, profileLoading, accountId, load, connect, t]);

  function handleAutoFill() {
    setContainerId(defaultId);
    toast.message(t('autoFilled'), { description: defaultId });
  }

  async function handleConnect() {
    await connect(containerId);
  }

  async function handleDisconnect() {
    if (!confirm(t('disconnectConfirm'))) return;
    setSaving(true);
    try {
      const res = await fetch('/api/gtm/config', { method: 'DELETE' });
      if (!res.ok) {
        toast.error(t('resetFailed'));
        return;
      }
      toast.success(t('disconnected'));
      setConnected(false);
      setContainerId(defaultId);
      autoConnectAttempted.current = true; // don't immediately re-auto-connect
    } catch {
      toast.error(t('resetFailed'));
    } finally {
      setSaving(false);
    }
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
            {connected ? (
              <CheckCircle2 className="size-4 text-emerald-500" />
            ) : (
              <XCircle className="size-4 text-muted-foreground" />
            )}
            <span className={connected ? 'text-emerald-600 dark:text-emerald-400' : undefined}>
              {connected ? t('statusConnected') : t('statusDisconnected')}
            </span>
          </CardTitle>
          <CardDescription>
            {connected
              ? t('statusConnectedDesc', { id: containerId })
              : t('statusDisconnectedDesc')}
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Tag className="size-4 text-primary" />
            {t('credentialsTitle')}
          </CardTitle>
          <CardDescription>{t('credentialsDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="gtm-container-id">{t('containerLabel')}</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="gtm-container-id"
                value={containerId}
                onChange={(e) => setContainerId(e.target.value.toUpperCase())}
                placeholder={t('containerPlaceholder')}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleAutoFill}
                disabled={saving}
              >
                {t('autoFill')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('containerHint')}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => void handleConnect()}
              disabled={saving || !containerId.trim()}
            >
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> {t('connecting')}
                </>
              ) : connected ? (
                t('save')
              ) : (
                t('connect')
              )}
            </Button>
            {connected ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleDisconnect()}
                disabled={saving}
              >
                {t('disconnect')}
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
