# wacrm — WhatsApp CRM on Replit

A self-hostable WhatsApp CRM template. Shared inbox, contacts, sales pipelines, broadcasts, and no-code automations — built on Next.js 16, React 19, TypeScript, Tailwind v4, and Supabase.

## How to run

```
npm run dev
```

The dev workflow (`wacrm: dev`) runs `npm run dev` and serves on port 3000.

## Required secrets / environment variables

The app will not start properly without these. Add them in Replit Secrets:

| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API (service role) |
| `ENCRYPTION_KEY` | Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `META_APP_SECRET` | Meta for Developers → App Settings → Basic |

## Optional secrets

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | Canonical URL (invite links, OG images) |
| `NEXT_PUBLIC_APP_LOCALE` | Default locale (`en` or `bn`) |
| `MESSENGER_VERIFY_TOKEN` | Messenger webhook verify token |

## Database migrations

Run all migrations in `supabase/migrations/` against your Supabase project before first use.
The latest migration `043_facebook_capi_view_content.sql` adds the `send_view_content_on_every_message` column to `facebook_capi_config`.

## Stack

- **App** — Next.js 16 (App Router), React 19, TypeScript, Tailwind v4
- **Data** — Supabase (Postgres + Auth + Storage + RLS)
- **WhatsApp** — Meta Cloud API (official WhatsApp Business API)

## Facebook Conversions API (CAPI)

Settings → Facebook Ads. Configured events:

- **LeadSubmitted** — fires on first inbound message from a contact
- **QualifiedLead** — fires when a new contact is auto-created
- **ViewContent** — fires on **every** subsequent inbound message, with message text included as `custom_data.content_name`, so Meta Pixel accumulates engagement signals across the full conversation

## User preferences

<!-- Add any project-specific preferences here -->
