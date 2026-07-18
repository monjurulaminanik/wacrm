'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { ArrowLeft } from 'lucide-react';
import { Input } from '@/components/ui/input';

type Punch = {
  id: string;
  punched_at: string;
  punch_type: string;
  source: string;
  employee: { full_name: string; employee_code: string | null } | null;
};

export default function HrAttendancePage() {
  const supabase = createClient();
  const [punches, setPunches] = useState<Punch[]>([]);
  const [dateFrom, setDateFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));

  const load = useCallback(async () => {
    let q = supabase
      .from('attendance_punches')
      .select('id, punched_at, punch_type, source, employee:hr_employees(full_name, employee_code)')
      .order('punched_at', { ascending: false })
      .limit(200);
    if (dateFrom) q = q.gte('punched_at', `${dateFrom}T00:00:00.000Z`);
    if (dateTo) q = q.lte('punched_at', `${dateTo}T23:59:59.999Z`);
    const { data } = await q;
    setPunches((data as unknown as Punch[]) ?? []);
  }, [supabase, dateFrom, dateTo]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/hr" className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> HR
        </Link>
        <h1 className="font-display text-2xl font-semibold">Attendance</h1>
        <p className="text-sm text-muted-foreground">Biometric + manual punches, filtered by time.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 w-auto" />
        <span className="text-xs text-muted-foreground">→</span>
        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 w-auto" />
      </div>

      <div className="glass-panel overflow-hidden rounded-2xl">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Employee</th>
              <th className="px-4 py-2">Time</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Source</th>
            </tr>
          </thead>
          <tbody>
            {punches.map((p) => (
              <tr key={p.id} className="border-t border-white/5">
                <td className="px-4 py-2.5 font-medium">
                  {p.employee?.full_name || '—'}
                  {p.employee?.employee_code ? (
                    <span className="ml-1 text-xs text-muted-foreground">({p.employee.employee_code})</span>
                  ) : null}
                </td>
                <td className="px-4 py-2.5">{new Date(p.punched_at).toLocaleString()}</td>
                <td className="px-4 py-2.5 uppercase">{p.punch_type}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{p.source}</td>
              </tr>
            ))}
            {punches.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                  No punches in this range
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
