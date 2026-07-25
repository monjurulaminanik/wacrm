import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Privacy policy for Dawat Lead CRM (RingGo) — how we handle WhatsApp and Messenger contact data.",
  robots: {
    index: true,
    follow: true,
  },
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-12 sm:py-16">
        <p className="text-sm text-muted-foreground">
          <Link href="/login" className="underline-offset-4 hover:underline">
            Dawat Lead CRM
          </Link>
          {" · "}
          RingGo Property
        </p>

        <h1 className="mt-4 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          Privacy Policy
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Last updated: 26 July 2026
        </p>

        <div className="mt-8 space-y-6 text-[15px] leading-relaxed text-foreground/90">
          <section className="space-y-2">
            <h2 className="text-lg font-semibold">1. Who we are</h2>
            <p>
              This policy describes how <strong>Dawat Lead CRM</strong> (also
              referred to as RingGo / WM CRM RINGO), operated for RingGo
              Property lead management at{" "}
              <a
                href="https://crm2.dawatit.com"
                className="underline underline-offset-4"
              >
                crm2.dawatit.com
              </a>
              , collects and uses information when you interact with our
              WhatsApp and Facebook Messenger business channels, or when our
              team uses the CRM inbox and contact tools.
            </p>
            <p className="text-muted-foreground">
              এই নীতিতে বলা হয়েছে আমরা WhatsApp ও Messenger ইনবক্স এবং
              কন্টাক্ট ডেটা কীভাবে ব্যবহার করি — রিয়েল-এস্টেট লিড ম্যানেজমেন্টের
              জন্য।
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">2. Information we collect</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                Contact details you share (name, phone number, email, property
                interest) via WhatsApp, Messenger, or forms.
              </li>
              <li>
                Message content and metadata needed to run a shared team inbox
                (timestamps, delivery status, assigned agent).
              </li>
              <li>
                Account information for CRM users (agents/admins): name, login
                email, and role within the workspace.
              </li>
              <li>
                Technical logs required for security, debugging, and Meta
                webhook delivery (e.g. request IDs, error codes).
              </li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">3. How we use information</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                To reply to customer inquiries about properties and services.
              </li>
              <li>
                To manage leads in pipelines, contacts, broadcasts, and
                automations inside the CRM.
              </li>
              <li>
                To operate WhatsApp Cloud API and Facebook Messenger
                integrations authorized through Meta.
              </li>
              <li>To improve reliability, prevent abuse, and meet legal duties.</li>
            </ul>
            <p>
              We do <strong>not</strong> sell personal data. We do not use
              Messenger/WhatsApp content for unrelated advertising outside the
              CRM workspace purpose described here.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">4. Meta platforms</h2>
            <p>
              When you message our WhatsApp Business or Facebook Page, Meta
              (WhatsApp / Facebook) processes the message under their terms.
              We receive that data through Meta&apos;s APIs solely to provide
              customer support and lead CRM features. You can also review{" "}
              <a
                href="https://www.facebook.com/privacy/policy/"
                className="underline underline-offset-4"
                rel="noopener noreferrer"
                target="_blank"
              >
                Meta&apos;s Privacy Policy
              </a>
              .
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">5. Sharing &amp; retention</h2>
            <p>
              Access is limited to authorized CRM workspace members and
              processors who help host the service (e.g. database/hosting
              providers under contract). We retain conversation and contact
              records while the business relationship is active and as needed
              for operations, dispute resolution, or legal requirements, then
              delete or anonymize when no longer needed.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">6. Your choices</h2>
            <p>
              You may request access, correction, or deletion of your contact
              data by messaging our business channel or emailing the contact
              below. You can also stop messaging us at any time. CRM users can
              ask their workspace admin to update or remove their account.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">7. Security</h2>
            <p>
              We use industry-standard safeguards (encrypted transport, access
              controls, authenticated APIs). No method of transmission or
              storage is 100% secure; please avoid sending unnecessary
              sensitive documents in chat.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">8. Contact</h2>
            <p>
              Questions about this policy:{" "}
              <a
                href="mailto:privacy@dawatit.com"
                className="underline underline-offset-4"
              >
                privacy@dawatit.com
              </a>{" "}
              or via our WhatsApp / Messenger business inbox.
            </p>
            <p className="text-muted-foreground">
              যোগাযোগ: privacy@dawatit.com অথবা আমাদের ব্যবসায়িক WhatsApp /
              Messenger ইনবক্স।
            </p>
          </section>
        </div>

        <p className="mt-12 text-sm text-muted-foreground">
          <Link href="/login" className="underline-offset-4 hover:underline">
            ← Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
