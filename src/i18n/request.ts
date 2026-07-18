import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import {
  DEFAULT_LOCALE,
  isAppLocale,
  LOCALE_COOKIE,
  mergeMessages,
  type AppLocale,
} from "./config";

async function resolveLocale(): Promise<AppLocale> {
  const jar = await cookies();
  const fromCookie = jar.get(LOCALE_COOKIE)?.value;
  if (isAppLocale(fromCookie)) return fromCookie;

  const fromEnv = process.env.NEXT_PUBLIC_APP_LOCALE;
  if (isAppLocale(fromEnv)) return fromEnv;

  return DEFAULT_LOCALE;
}

export default getRequestConfig(async () => {
  const locale = await resolveLocale();

  const en = (await import(`../../messages/en.json`)).default as Record<
    string,
    unknown
  >;

  let messages = en;
  if (locale !== "en") {
    try {
      const localized = (await import(`../../messages/${locale}.json`))
        .default as Record<string, unknown>;
      messages = mergeMessages(en, localized);
    } catch {
      messages = en;
    }
  }

  return { locale, messages };
});
