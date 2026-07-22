import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function isDemoLoginEnabled(): boolean {
  const flag = process.env.DEMO_LOGIN_ENABLED?.trim().toLowerCase();
  return flag === "true" || flag === "1" || flag === "yes";
}

/**
 * GET — whether the one-click demo login button should appear.
 * Never returns credentials.
 */
export async function GET() {
  return NextResponse.json({ enabled: isDemoLoginEnabled() });
}

/**
 * POST — sign in with server-side DEMO_LOGIN_EMAIL / DEMO_LOGIN_PASSWORD.
 * Only works when DEMO_LOGIN_ENABLED=true. Sets Supabase auth cookies.
 */
export async function POST() {
  if (!isDemoLoginEnabled()) {
    return NextResponse.json(
      { error: "Demo login is disabled" },
      { status: 403 },
    );
  }

  const email = process.env.DEMO_LOGIN_EMAIL?.trim();
  const password = process.env.DEMO_LOGIN_PASSWORD;
  if (!email || !password) {
    return NextResponse.json(
      {
        error:
          "Demo login is enabled but DEMO_LOGIN_EMAIL / DEMO_LOGIN_PASSWORD are not set",
      },
      { status: 500 },
    );
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    return NextResponse.json({
      success: true,
      user: { id: data.user?.id, email: data.user?.email },
    });
  } catch (err) {
    console.error("[auth/demo-login]", err);
    return NextResponse.json({ error: "Demo login failed" }, { status: 500 });
  }
}
