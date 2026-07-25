import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { syncMessengerFromGraph } from "@/lib/messenger/sync";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null;
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _adminClient;
}

function configuredCronSecrets(): string[] {
  return [
    process.env.CRON_SECRET,
    process.env.MESSENGER_SYNC_SECRET,
    process.env.AUTOMATION_CRON_SECRET,
  ]
    .map((s) => s?.trim())
    .filter((s): s is string => Boolean(s));
}

function secretMatches(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * True when request carries a valid cron secret.
 * Accepts Vercel Cron (`Authorization: Bearer <CRON_SECRET>`) and
 * the same `x-cron-secret` header used by automations/flows crons.
 */
function isCronAuthorized(request: Request): boolean {
  const secrets = configuredCronSecrets();
  if (!secrets.length) return false;

  const candidates: string[] = [];
  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    candidates.push(auth.slice(7).trim());
  }
  const headerSecret = request.headers.get("x-cron-secret");
  if (headerSecret) candidates.push(headerSecret.trim());

  for (const supplied of candidates) {
    if (!supplied) continue;
    for (const expected of secrets) {
      if (secretMatches(supplied, expected)) return true;
    }
  }
  return false;
}

async function runSync(opts: { accountId?: string }) {
  const stats = await syncMessengerFromGraph(supabaseAdmin(), opts);
  return NextResponse.json({
    ok: true,
    // Live + webhook = instant; this job = must catch-up within a few minutes.
    mode: "graph_poll_fallback",
    ...stats,
  });
}

/**
 * GET — Vercel Cron entrypoint (every few minutes).
 * Auth: Bearer CRON_SECRET / MESSENGER_SYNC_SECRET (or x-cron-secret).
 */
export async function GET(request: Request) {
  try {
    if (!isCronAuthorized(request)) {
      if (!configuredCronSecrets().length) {
        return NextResponse.json(
          { error: "cron not configured — set CRON_SECRET or MESSENGER_SYNC_SECRET" },
          { status: 503 },
        );
      }
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return await runSync({});
  } catch (err) {
    console.error("[messenger/sync GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * POST — cron (same secrets) OR logged-in admin "Sync now".
 * Admin scoped to their account; cron syncs all connected Pages.
 */
export async function POST(request: Request) {
  try {
    if (isCronAuthorized(request)) {
      return await runSync({});
    }

    // Session path: owner/admin Settings → Sync now
    try {
      const ctx = await requireRole("admin");
      return await runSync({ accountId: ctx.accountId });
    } catch (err) {
      return toErrorResponse(err);
    }
  } catch (err) {
    console.error("[messenger/sync POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
