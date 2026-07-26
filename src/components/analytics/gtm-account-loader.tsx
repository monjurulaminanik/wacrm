'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { GtmScript } from './gtm-script';
import {
  isValidGtmContainerId,
  normalizeGtmContainerId,
  resolveEnvGtmContainerId,
} from '@/lib/gtm';

/**
 * Loads account-scoped GTM inside the authenticated app shell.
 * Skips injection when the same ID is already loaded from NEXT_PUBLIC_GTM_ID
 * in the root layout (avoids double-init).
 */
export function GtmAccountLoader() {
  const { accountId, loading: authLoading, profileLoading } = useAuth();
  const [containerId, setContainerId] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || profileLoading || !accountId) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/gtm/config', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        if (
          data.connected &&
          typeof data.container_id === 'string' &&
          isValidGtmContainerId(data.container_id)
        ) {
          setContainerId(normalizeGtmContainerId(data.container_id));
        } else {
          setContainerId(null);
        }
      } catch {
        // fail-open — analytics must never break the CRM shell
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accountId, authLoading, profileLoading]);

  if (!containerId) return null;

  // Root layout already injects the env ID when set — don't load twice.
  const envId = resolveEnvGtmContainerId();
  if (envId && envId === containerId) return null;

  return <GtmScript containerId={containerId} />;
}
