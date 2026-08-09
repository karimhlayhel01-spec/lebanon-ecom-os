/**
 * Wave 3 Phase 3a — open a Gmail compose window with the negotiation draft.
 * Confirmed Zapier/Gmail MCP send is Phase 3b (SUPPLIER_GMAIL_SEND).
 */

export function buildGmailComposeUrl(input: {
  subject: string;
  body: string;
  to?: string;
}): string {
  const params = new URLSearchParams();
  params.set("view", "cm");
  params.set("fs", "1");
  if (input.to?.trim()) params.set("to", input.to.trim());
  params.set("su", input.subject.slice(0, 200));
  // Gmail compose URL body length is practical-capped by browsers.
  params.set("body", input.body.slice(0, 1800));
  return `https://mail.google.com/mail/?${params.toString()}`;
}

export function supplierEmailSubject(
  productName: string,
  locale: "en" | "ar" = "en",
): string {
  const name = productName.replace(/\s+/g, " ").trim() || "product";
  return locale === "ar"
    ? `طلب عيّنة — ${name}`
    : `Sample inquiry — ${name}`;
}
