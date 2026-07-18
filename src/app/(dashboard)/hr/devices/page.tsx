'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { ArrowLeft, Copy, Plus } from 'lucide-react';

function randomKey() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

type Device = {
  id: string;
  name: string;
  device_type: string;
  serial_number: string | null;
  api_key: string;
  status: string;
  last_seen_at: string | null;
};

export default function HrDevicesPage() {
  const supabase = createClient();
  const { accountId, user } = useAuth();
  const [devices, setDevices] = useState<Device[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [deviceType, setDeviceType] = useState('zkteco');
  const [serial, setSerial] = useState('');
  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/biometric/punch`
      : '/api/biometric/punch';

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('biometric_devices')
      .select('*')
      .order('created_at', { ascending: false });
    setDevices((data as Device[]) ?? []);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addDevice() {
    if (!accountId || !user || !name.trim()) return;
    const api_key = randomKey();
    const { error } = await supabase.from('biometric_devices').insert({
      account_id: accountId,
      user_id: user.id,
      name: name.trim(),
      device_type: deviceType,
      serial_number: serial.trim() || null,
      api_key,
      status: 'active',
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Device added — copy the API key');
    setOpen(false);
    setName('');
    setSerial('');
    void load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/hr" className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" /> HR
          </Link>
          <h1 className="font-display text-2xl font-semibold">Biometric devices</h1>
          <p className="text-sm text-muted-foreground">
            ZKTeco / eSSL / Hikvision middleware → POST punches to this CRM.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="mr-1.5 size-4" /> Add device
        </Button>
      </div>

      <div className="glass-panel rounded-2xl p-4 text-sm">
        <p className="font-medium text-foreground">Punch webhook</p>
        <code className="mt-1 block break-all rounded-lg bg-muted/50 px-3 py-2 text-xs">{webhookUrl}</code>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-muted/40 p-3 text-[11px] text-muted-foreground">{`POST ${webhookUrl}
Authorization: Bearer <device_api_key>
{ "biometric_user_id": "1001", "punch_type": "in" }`}</pre>
      </div>

      <div className="glass-panel overflow-hidden rounded-2xl">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">API key</th>
              <th className="px-4 py-2">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => (
              <tr key={d.id} className="border-t border-white/5">
                <td className="px-4 py-2.5 font-medium">{d.name}</td>
                <td className="px-4 py-2.5 uppercase text-muted-foreground">{d.device_type}</td>
                <td className="px-4 py-2.5">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline"
                    onClick={() => {
                      void navigator.clipboard.writeText(d.api_key);
                      toast.success('API key copied');
                    }}
                  >
                    <Copy className="size-3" />
                    {d.api_key.slice(0, 10)}…
                  </button>
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">
                  {d.last_seen_at ? new Date(d.last_seen_at).toLocaleString() : '—'}
                </td>
              </tr>
            ))}
            {devices.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                  No devices yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add biometric device</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Office door" />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <select
                className="h-9 w-full rounded-md border border-border bg-muted px-3 text-sm"
                value={deviceType}
                onChange={(e) => setDeviceType(e.target.value)}
              >
                <option value="zkteco">ZKTeco</option>
                <option value="essl">eSSL</option>
                <option value="hikvision">Hikvision</option>
                <option value="generic">Generic HTTP</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Serial (optional)</Label>
              <Input value={serial} onChange={(e) => setSerial(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void addDevice()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
