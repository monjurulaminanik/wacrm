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
import { Fingerprint, Plus, Users, Wallet, Clock } from 'lucide-react';

type Employee = {
  id: string;
  full_name: string;
  employee_code: string | null;
  department: string | null;
  designation: string | null;
  phone: string | null;
  salary_basic: number | null;
  biometric_user_id: string | null;
  status: string;
};

export default function HrPage() {
  const supabase = createClient();
  const { accountId, user } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    full_name: '',
    employee_code: '',
    department: '',
    designation: '',
    phone: '',
    biometric_user_id: '',
    salary_basic: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('hr_employees')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) toast.error(error.message);
    setEmployees((data as Employee[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveEmployee() {
    if (!accountId || !user || !form.full_name.trim()) {
      toast.error('Name required');
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('hr_employees').insert({
      account_id: accountId,
      user_id: user.id,
      full_name: form.full_name.trim(),
      employee_code: form.employee_code.trim() || null,
      department: form.department.trim() || null,
      designation: form.designation.trim() || null,
      phone: form.phone.trim() || null,
      biometric_user_id: form.biometric_user_id.trim() || null,
      salary_basic: form.salary_basic ? Number(form.salary_basic) : 0,
      status: 'active',
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Employee added');
    setOpen(false);
    setForm({
      full_name: '',
      employee_code: '',
      department: '',
      designation: '',
      phone: '',
      biometric_user_id: '',
      salary_basic: '',
    });
    void load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-wide">HR & Payroll</h1>
          <p className="text-sm text-muted-foreground">
            Employees, biometric attendance, and payroll runs.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/hr/attendance"
            className="inline-flex h-9 items-center rounded-md border border-border bg-background px-3 text-sm hover:bg-muted"
          >
            <Clock className="mr-1.5 size-4" /> Attendance
          </Link>
          <Link
            href="/hr/devices"
            className="inline-flex h-9 items-center rounded-md border border-border bg-background px-3 text-sm hover:bg-muted"
          >
            <Fingerprint className="mr-1.5 size-4" /> Devices
          </Link>
          <Link
            href="/hr/payroll"
            className="inline-flex h-9 items-center rounded-md border border-border bg-background px-3 text-sm hover:bg-muted"
          >
            <Wallet className="mr-1.5 size-4" /> Payroll
          </Link>
          <Button onClick={() => setOpen(true)}>
            <Plus className="mr-1.5 size-4" /> Add employee
          </Button>
        </div>
      </div>

      <div className="glass-panel overflow-hidden rounded-2xl">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3 text-sm text-muted-foreground">
          <Users className="size-4" />
          {loading ? 'Loading…' : `${employees.length} employees`}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Code</th>
                <th className="px-4 py-2 font-medium">Dept</th>
                <th className="px-4 py-2 font-medium">Biometric ID</th>
                <th className="px-4 py-2 font-medium">Basic</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id} className="border-t border-white/5">
                  <td className="px-4 py-2.5 font-medium">{e.full_name}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{e.employee_code || '—'}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{e.department || '—'}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{e.biometric_user_id || '—'}</td>
                  <td className="px-4 py-2.5">{e.salary_basic ?? 0}</td>
                  <td className="px-4 py-2.5 capitalize">{e.status}</td>
                </tr>
              ))}
              {!loading && employees.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                    No employees yet — add your team to start attendance & payroll.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add employee</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1.5">
              <Label>Full name</Label>
              <Input
                value={form.full_name}
                onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Employee code</Label>
                <Input
                  value={form.employee_code}
                  onChange={(e) => setForm((f) => ({ ...f, employee_code: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Biometric user ID</Label>
                <Input
                  value={form.biometric_user_id}
                  onChange={(e) => setForm((f) => ({ ...f, biometric_user_id: e.target.value }))}
                  placeholder="Device user id"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Department</Label>
                <Input
                  value={form.department}
                  onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Basic salary</Label>
                <Input
                  type="number"
                  value={form.salary_basic}
                  onChange={(e) => setForm((f) => ({ ...f, salary_basic: e.target.value }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void saveEmployee()} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
