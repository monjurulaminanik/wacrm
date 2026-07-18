-- ============================================================
-- 038_hr_payroll_attendance.sql
-- HR employees, biometric devices, attendance punches, payroll
-- ============================================================

CREATE TABLE IF NOT EXISTS hr_employees (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  department TEXT,
  designation TEXT,
  employee_code TEXT,
  biometric_user_id TEXT,
  join_date DATE,
  salary_basic NUMERIC(14,2) DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'terminated')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (account_id, employee_code)
);

CREATE INDEX IF NOT EXISTS idx_hr_employees_account ON hr_employees(account_id);
CREATE INDEX IF NOT EXISTS idx_hr_employees_biometric
  ON hr_employees(account_id, biometric_user_id)
  WHERE biometric_user_id IS NOT NULL AND biometric_user_id <> '';

CREATE TABLE IF NOT EXISTS biometric_devices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  device_type TEXT NOT NULL DEFAULT 'generic'
    CHECK (device_type IN ('generic', 'zkteco', 'essl', 'hikvision')),
  serial_number TEXT,
  api_key TEXT NOT NULL,
  location TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (account_id, api_key)
);

CREATE INDEX IF NOT EXISTS idx_biometric_devices_account ON biometric_devices(account_id);
CREATE INDEX IF NOT EXISTS idx_biometric_devices_api_key ON biometric_devices(api_key);

CREATE TABLE IF NOT EXISTS attendance_punches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  device_id UUID REFERENCES biometric_devices(id) ON DELETE SET NULL,
  punched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  punch_type TEXT NOT NULL DEFAULT 'auto'
    CHECK (punch_type IN ('in', 'out', 'auto')),
  source TEXT NOT NULL DEFAULT 'biometric'
    CHECK (source IN ('biometric', 'manual', 'api')),
  raw_payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attendance_punches_account_time
  ON attendance_punches(account_id, punched_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_punches_employee_time
  ON attendance_punches(employee_id, punched_at DESC);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_label TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'paid')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payroll_runs_account ON payroll_runs(account_id);

CREATE TABLE IF NOT EXISTS payroll_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payroll_run_id UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  basic NUMERIC(14,2) NOT NULL DEFAULT 0,
  allowances NUMERIC(14,2) NOT NULL DEFAULT 0,
  deductions NUMERIC(14,2) NOT NULL DEFAULT 0,
  net NUMERIC(14,2) NOT NULL DEFAULT 0,
  days_present NUMERIC(6,2) DEFAULT 0,
  notes TEXT,
  UNIQUE (payroll_run_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_items_run ON payroll_items(payroll_run_id);

ALTER TABLE hr_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE biometric_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_punches ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hr_employees_select ON hr_employees;
DROP POLICY IF EXISTS hr_employees_write ON hr_employees;
CREATE POLICY hr_employees_select ON hr_employees FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY hr_employees_write ON hr_employees FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS biometric_devices_select ON biometric_devices;
DROP POLICY IF EXISTS biometric_devices_write ON biometric_devices;
CREATE POLICY biometric_devices_select ON biometric_devices FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY biometric_devices_write ON biometric_devices FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS attendance_punches_select ON attendance_punches;
DROP POLICY IF EXISTS attendance_punches_write ON attendance_punches;
CREATE POLICY attendance_punches_select ON attendance_punches FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY attendance_punches_write ON attendance_punches FOR ALL
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS payroll_runs_select ON payroll_runs;
DROP POLICY IF EXISTS payroll_runs_write ON payroll_runs;
CREATE POLICY payroll_runs_select ON payroll_runs FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY payroll_runs_write ON payroll_runs FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS payroll_items_select ON payroll_items;
DROP POLICY IF EXISTS payroll_items_write ON payroll_items;
CREATE POLICY payroll_items_select ON payroll_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM payroll_runs r
      WHERE r.id = payroll_items.payroll_run_id
        AND is_account_member(r.account_id)
    )
  );
CREATE POLICY payroll_items_write ON payroll_items FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM payroll_runs r
      WHERE r.id = payroll_items.payroll_run_id
        AND is_account_member(r.account_id, 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM payroll_runs r
      WHERE r.id = payroll_items.payroll_run_id
        AND is_account_member(r.account_id, 'admin')
    )
  );

DROP TRIGGER IF EXISTS set_updated_at ON hr_employees;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON hr_employees
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at ON biometric_devices;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON biometric_devices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at ON payroll_runs;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON payroll_runs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
