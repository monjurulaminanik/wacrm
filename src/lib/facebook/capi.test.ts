import { describe, expect, it } from "vitest";
import {
  formatMetaCapiError,
  sanitizeTestEventCode,
  validateCapiChannelUser,
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

describe("validateCapiChannelUser", () => {
  it("requires WABA for WhatsApp", () => {
    expect(
      validateCapiChannelUser("whatsapp", { contactId: "c1" }),
    ).toMatch(/WABA/);
  });

  it("requires Page ID + PSID for Messenger", () => {
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
    ).toBeNull();
  });
});
