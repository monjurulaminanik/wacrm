'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { ArrowLeft, Plus } from 'lucide-react';

type Run = {
  id: string;
  period_label: string;
  period_start: string;
  period_end: string;
  status: string;
};

export default function HrPayrollPage() {
  const supabase = createClient();
  const { accountId, user } = useAuth();
  const [runs, setRuns] = useState<Run[]>([]);
  const [label, setLabel] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('payroll_runs')
      .select('*')
      .order('created_at', { ascending: false });
    setRuns((data as Run[]) ?? []);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createRun() {
    if (!accountId || !user || !label.trim() || !start || !end) {
      toast.error('Label + dates required');
      return;
    }
    setCreating(true);
    const { data: run, error } = await supabase
      .from('payroll_runs')
      .insert({
        account_id: accountId,
        user_id: user.id,
        period_label: label.trim(),
        period_start: start,
        period_end: end,
        status: 'draft',
      })
      .select('id')
      .single();

    if (error || !run) {
      setCreating(false);
      toast.error(error?.message || 'Failed');
      return;
    }

    const { data: employees } = await supabase
      .from('hr_employees')
      .select('id, salary_basic')
      .eq('status', 'active');

    if (employees?.length) {
      await supabase.from('payroll_items').insert(
        employees.map((e) => {
          const basic = Number(e.salary_basic || 0);
          return {
            payroll_run_id: run.id,
            employee_id: e.id,
            basic,
            allowances: 0,
            deductions: 0,
            net: basic,
            days_present: 0,
          };
        }),
      );
    }

    setCreating(false);
    toast.success('Payroll run created');
    setLabel('');
    void load();
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/hr" className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> HR
        </Link>
        <h1 className="font-display text-2xl font-semibold">Payroll</h1>
        <p className="text-sm text-muted-foreground">
          Create period runs from employee basic salaries (MVP).
        </p>
      </div>

      <div className="glass-panel grid gap-3 rounded-2xl p-4 sm:grid-cols-4">
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Period label</Label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="July 2026" />
        </div>
        <div className="space-y-1.5">
          <Label>Start</Label>
          <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>End</Label>
          <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <div className="sm:col-span-4">
          <Button onClick={() => void createRun()} disabled={creating}>
            <Plus className="mr-1.5 size-4" />
            {creating ? 'Creating…' : 'Create payroll run'}
          </Button>
        </div>
      </div>

      <div className="glass-panel overflow-hidden rounded-2xl">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Period</th>
              <th className="px-4 py-2">Range</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} className="border-t border-white/5">
                <td className="px-4 py-2.5 font-medium">{r.period_label}</td>
                <td className="px-4 py-2.5 text-muted-foreground">
                  {r.period_start} → {r.period_end}
                </td>
                <td className="px-4 py-2.5 capitalize">{r.status}</td>
              </tr>
            ))}
            {runs.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">
                  No payroll runs yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
