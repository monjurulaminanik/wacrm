import { describe, expect, it } from "vitest";
import {
  CAPI_MESSENGER_PSID_HINT_BN,
  enrichCapiErrorForUi,
  isValidMessengerPsid,
  sanitizeTestEventCode,
  validateCapiChannelUser,
  formatMetaCapiError,
} from "./capi";

describe("sanitizeTestEventCode", () => {
  it("drops blank and UI placeholders", () => {
    expect(sanitizeTestEventCode(null)).toBeNull();
    expect(sanitizeTestEventCode("")).toBeNull();
    expect(sanitizeTestEventCode("TEST12345")).toBeNull();
    expect(sanitizeTestEventCode("test12345")).toBeNull();
  });

  it("keeps real Events Manager codes", () => {
    expect(sanitizeTestEventCode("TEST48291")).toBe("TEST48291");
  });
});

describe("formatMetaCapiError", () => {
  it("prefers error_user_msg over Invalid parameter", () => {
    expect(
      formatMetaCapiError({
        error: {
          message: "Invalid parameter",
          error_user_title: "Missing WhatsApp Business Account ID",
          error_user_msg:
            "whatsapp_business_account_id is required for messaging_channel=whatsapp",
        },
      }),
    ).toContain("whatsapp_business_account_id");
  });
});

describe("isValidMessengerPsid", () => {
  it("accepts long numeric PSIDs", () => {
    expect(isValidMessengerPsid("1234567890123456")).toBe(true);
  });

  it("rejects empty, short, non-numeric, and placeholders", () => {
    expect(isValidMessengerPsid(null)).toBe(false);
    expect(isValidMessengerPsid("")).toBe(false);
    expect(isValidMessengerPsid("abc")).toBe(false);
    expect(isValidMessengerPsid("12345")).toBe(false);
    expect(isValidMessengerPsid("0000000000")).toBe(false);
    expect(isValidMessengerPsid("1234567890")).toBe(false);
  });
});

describe("enrichCapiErrorForUi", () => {
  it("appends Bangla PSID hint for Meta PSID errors", () => {
    const msg = enrichCapiErrorForUi(
      "Invalid Page-scoped user ID: The page_scoped_user_id parameter is invalid.",
    );
    expect(msg).toContain(CAPI_MESSENGER_PSID_HINT_BN);
  });
});

describe("validateCapiChannelUser", () => {
  it("requires WABA for WhatsApp", () => {
    expect(
      validateCapiChannelUser("whatsapp", { contactId: "c1" }),
    ).toMatch(/WABA/);
  });

  it("requires Page ID + valid PSID for Messenger", () => {
    expect(
      validateCapiChannelUser("messenger", {
        contactId: "c1",
        pageId: "123",
      }),
    ).toMatch(/PSID/);
    expect(
      validateCapiChannelUser("messenger", {
        contactId: "c1",
        pageId: "123",
        messengerPsid: "999",
      }),
    ).toMatch(/PSID/);
    expect(
      validateCapiChannelUser("messenger", {
        contactId: "c1",
        pageId: "123",
        messengerPsid: "1234567890123456",
      }),
    ).toBeNull();
  });
});
