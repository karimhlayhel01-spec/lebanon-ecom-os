import { describe, expect, it } from "vitest";
import {
  buildWhatsAppChatUrl,
  evaluateSaveSupplierContacts,
  normalizeContactEmail,
  normalizeContactWhatsapp,
  SUPPLIER_CONTACT_MAX,
  whatsappDigitsForLink,
} from "@/lib/supplier/contacts";
import { buildGmailComposeUrl } from "@/lib/supplier/email/gmail-compose";

describe("normalizeContactEmail", () => {
  it("empty → null", () => {
    expect(normalizeContactEmail("")).toEqual({ ok: true, value: null });
    expect(normalizeContactEmail("  ")).toEqual({ ok: true, value: null });
    expect(normalizeContactEmail(null)).toEqual({ ok: true, value: null });
  });

  it("accepts simple emails and clamps length", () => {
    expect(normalizeContactEmail("  sales@foo.com ")).toEqual({
      ok: true,
      value: "sales@foo.com",
    });
    const local = "a".repeat(80);
    const email = `${local}@x.co`;
    expect(email.length).toBeLessThanOrEqual(SUPPLIER_CONTACT_MAX);
    expect(normalizeContactEmail(email)).toEqual({ ok: true, value: email });
    const tooLong = `${"a".repeat(SUPPLIER_CONTACT_MAX)}@x.co`;
    const res = normalizeContactEmail(tooLong);
    // Slice may break shape — either clamped valid or invalid_email is fine.
    if (res.ok) {
      expect(res.value!.length).toBeLessThanOrEqual(SUPPLIER_CONTACT_MAX);
    } else {
      expect(res.error).toBe("invalid_email");
    }
  });

  it("rejects invalid shape", () => {
    expect(normalizeContactEmail("not-an-email")).toEqual({
      ok: false,
      error: "invalid_email",
    });
    expect(normalizeContactEmail("a@b")).toEqual({
      ok: false,
      error: "invalid_email",
    });
  });
});

describe("normalizeContactWhatsapp", () => {
  it("empty → null", () => {
    expect(normalizeContactWhatsapp("")).toBeNull();
    expect(normalizeContactWhatsapp("abc")).toBeNull();
  });

  it("keeps digits and leading +", () => {
    expect(normalizeContactWhatsapp("+961 71 123 456")).toBe("+96171123456");
    expect(normalizeContactWhatsapp("03-123456")).toBe("03123456");
  });
});

describe("evaluateSaveSupplierContacts", () => {
  it("rejects not owned / too early", () => {
    expect(
      evaluateSaveSupplierContacts({
        supplierOwned: false,
        hasSampleRecord: true,
        emailRaw: "a@b.co",
        whatsappRaw: null,
      }),
    ).toEqual({ ok: false, error: "not_found" });
    expect(
      evaluateSaveSupplierContacts({
        supplierOwned: true,
        hasSampleRecord: false,
        emailRaw: "a@b.co",
        whatsappRaw: null,
      }),
    ).toEqual({ ok: false, error: "too_early" });
  });

  it("allows clear-to-null and valid pair", () => {
    expect(
      evaluateSaveSupplierContacts({
        supplierOwned: true,
        hasSampleRecord: true,
        emailRaw: " ",
        whatsappRaw: "",
      }),
    ).toEqual({
      ok: true,
      contactEmail: null,
      contactWhatsapp: null,
    });
    expect(
      evaluateSaveSupplierContacts({
        supplierOwned: true,
        hasSampleRecord: true,
        emailRaw: "sales@co.com",
        whatsappRaw: "+96171123456",
      }),
    ).toEqual({
      ok: true,
      contactEmail: "sales@co.com",
      contactWhatsapp: "+96171123456",
    });
  });

  it("rejects invalid email", () => {
    expect(
      evaluateSaveSupplierContacts({
        supplierOwned: true,
        hasSampleRecord: true,
        emailRaw: "nope",
        whatsappRaw: null,
      }),
    ).toEqual({ ok: false, error: "invalid_email" });
  });
});

describe("WhatsApp + Gmail helpers", () => {
  it("builds wa.me from digits", () => {
    expect(whatsappDigitsForLink("+961 71 123")).toBe("96171123");
    expect(buildWhatsAppChatUrl("+96171123456")).toBe(
      "https://wa.me/96171123456",
    );
    expect(buildWhatsAppChatUrl(null)).toBeNull();
  });

  it("Gmail compose includes to when email set", () => {
    const url = buildGmailComposeUrl({
      to: "sales@co.com",
      subject: "Sample inquiry — Widget",
      body: "Hello",
    });
    expect(url).toContain("to=sales%40co.com");
    expect(url).toContain("su=");
    expect(url).toContain("body=");
  });

  it("Gmail compose omits to when unset", () => {
    const url = buildGmailComposeUrl({
      subject: "Hi",
      body: "Body",
    });
    expect(url).not.toContain("to=");
  });
});
