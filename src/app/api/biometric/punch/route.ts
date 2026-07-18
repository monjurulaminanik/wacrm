import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const maxDuration = 30;

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/**
 * Biometric punch webhook — devices / middleware POST here.
 *
 * Auth: `Authorization: Bearer <device_api_key>` or body.api_key
 * Body: { biometric_user_id, punched_at?, punch_type?, employee_code? }
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      api_key?: string;
      biometric_user_id?: string;
      employee_code?: string;
      punched_at?: string;
      punch_type?: "in" | "out" | "auto";
      raw?: unknown;
    };

    const auth = request.headers.get("authorization") || "";
    const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    const apiKey = bearer || body.api_key?.trim();
    if (!apiKey) {
      return NextResponse.json({ error: "api_key required" }, { status: 401 });
    }

    const db = admin();
    const { data: device } = await db
      .from("biometric_devices")
      .select("id, account_id, status")
      .eq("api_key", apiKey)
      .maybeSingle();

    if (!device || device.status !== "active") {
      return NextResponse.json({ error: "Unknown or inactive device" }, { status: 401 });
    }

    let employeeId: string | null = null;
    if (body.biometric_user_id) {
      const { data: emp } = await db
        .from("hr_employees")
        .select("id")
        .eq("account_id", device.account_id)
        .eq("biometric_user_id", String(body.biometric_user_id))
        .eq("status", "active")
        .maybeSingle();
      employeeId = emp?.id ?? null;
    }
    if (!employeeId && body.employee_code) {
      const { data: emp } = await db
        .from("hr_employees")
        .select("id")
        .eq("account_id", device.account_id)
        .eq("employee_code", String(body.employee_code))
        .eq("status", "active")
        .maybeSingle();
      employeeId = emp?.id ?? null;
    }

    if (!employeeId) {
      return NextResponse.json(
        { error: "Employee not found for biometric_user_id / employee_code" },
        { status: 404 },
      );
    }

    const punchedAt = body.punched_at
      ? new Date(body.punched_at).toISOString()
      : new Date().toISOString();

    const { data: punch, error } = await db
      .from("attendance_punches")
      .insert({
        account_id: device.account_id,
        employee_id: employeeId,
        device_id: device.id,
        punched_at: punchedAt,
        punch_type: body.punch_type || "auto",
        source: "biometric",
        raw_payload: body.raw ?? body,
      })
      .select("id, punched_at")
      .single();

    if (error) {
      console.error("[biometric/punch]", error);
      return NextResponse.json({ error: "Failed to save punch" }, { status: 500 });
    }

    await db
      .from("biometric_devices")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", device.id);

    return NextResponse.json({ ok: true, punch });
  } catch (err) {
    console.error("[biometric/punch]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
