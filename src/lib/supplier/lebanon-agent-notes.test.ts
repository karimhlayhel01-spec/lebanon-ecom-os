import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  CLEARANCE_BROKER_EXAMPLE_HOSTS,
  IMPORT_SOURCING_EXAMPLE_HOSTS,
  shouldShowImportSourcingAgentNote,
  splitExampleHostLinks,
} from "@/lib/supplier/lebanon-agent-notes";

function loadMessages() {
  const en = JSON.parse(
    readFileSync(path.join(process.cwd(), "messages/en.json"), "utf8"),
  ) as {
    Supplier: {
      importSourcingAgentNote: string;
      clearancePartnerPlaceholder: string;
      costQuotesGuideClearance: string;
      clearanceLocalSoft: string;
      clearanceLocalVsDeliveryNote: string;
      clearanceBothNote: string;
    };
  };
  const ar = JSON.parse(
    readFileSync(path.join(process.cwd(), "messages/ar.json"), "utf8"),
  ) as {
    Supplier: {
      importSourcingAgentNote: string;
      clearancePartnerPlaceholder: string;
      costQuotesGuideClearance: string;
    };
  };
  return { en: en.Supplier, ar: ar.Supplier };
}

const FORBIDDEN_CONTACT = [/\+961/, /whatsapp/i, /wa\.me/i];
const SOURCING_HOSTS_ON_CLEARANCE = [
  /nourexpress/i,
  /picknship/i,
  /chinagatelb/i,
  /chinatolebanon/i,
];

describe("Lebanon agent + broker example notes", () => {
  it("EN+AR sourcing note has four names, hosts, not-partners, duties", () => {
    const { en, ar } = loadMessages();
    for (const text of [en.importSourcingAgentNote, ar.importSourcingAgentNote]) {
      expect(text).toContain("Nour Express");
      expect(text).toContain("China to Lebanon");
      expect(text).toContain("Pick N Ship");
      expect(text).toContain("China Gate");
      expect(text).toContain("nourexpress.me");
      expect(text).toContain("chinatolebanon.com");
      expect(text).toContain("picknship.net");
      expect(text).toContain("chinagatelb.com");
    }
    expect(en.importSourcingAgentNote.toLowerCase()).toContain("not partners");
    expect(en.importSourcingAgentNote).toMatch(/duties/i);
    expect(ar.importSourcingAgentNote).not.toContain("سعر المتجر");
    expect(ar.importSourcingAgentNote).toMatch(/رسوم|رسومك|الرسوم/);
  });

  it("EN clearance copy has broker hosts and not sourcing-agent names", () => {
    const { en } = loadMessages();
    for (const text of [
      en.clearancePartnerPlaceholder,
      en.costQuotesGuideClearance,
    ]) {
      expect(text).toContain("asl.com.lb");
      expect(text).toContain("oceanlink-lb.com");
      expect(text).toContain("chami.co");
      for (const banned of SOURCING_HOSTS_ON_CLEARANCE) {
        expect(text).not.toMatch(banned);
      }
    }
    expect(en.clearanceLocalSoft).not.toMatch(/asl\.com\.lb/);
    expect(en.clearanceLocalVsDeliveryNote).not.toMatch(/chami\.co/);
    expect(en.clearanceBothNote).not.toMatch(/oceanlink-lb\.com/);
  });

  it("new strings have no phones or WhatsApp", () => {
    const { en, ar } = loadMessages();
    const blob = [
      en.importSourcingAgentNote,
      ar.importSourcingAgentNote,
      en.clearancePartnerPlaceholder,
      ar.clearancePartnerPlaceholder,
      en.costQuotesGuideClearance,
      ar.costQuotesGuideClearance,
    ].join("\n");
    for (const re of FORBIDDEN_CONTACT) {
      expect(blob).not.toMatch(re);
    }
  });

  it("shows sourcing note on Import and Both, not Local-only", () => {
    expect(shouldShowImportSourcingAgentNote("import")).toBe(true);
    expect(shouldShowImportSourcingAgentNote("both")).toBe(true);
    expect(shouldShowImportSourcingAgentNote("local")).toBe(false);
    const panel = readFileSync(
      path.join(process.cwd(), "src/components/supplier/SupplierPanel.tsx"),
      "utf8",
    );
    expect(panel).toContain("importSourcingAgentNote");
    expect(panel).toContain("shouldShowImportSourcingAgentNote");
    expect(panel).toContain("ImportSourcingAgentNote");
  });

  it("does not add the note to Discovery service", () => {
    const discovery = readFileSync(
      path.join(process.cwd(), "src/lib/discovery/service.ts"),
      "utf8",
    );
    expect(discovery).not.toContain("importSourcingAgentNote");
    expect(discovery).not.toContain("chinatolebanon");
  });

  it("linkifies only allow-listed https hosts", () => {
    const parts = splitExampleHostLinks(
      "See Nour Express (nourexpress.me) not evil.com",
      IMPORT_SOURCING_EXAMPLE_HOSTS,
    );
    const links = parts.filter((p) => p.kind === "link");
    expect(links).toEqual([
      { kind: "link", value: "nourexpress.me", href: "https://nourexpress.me" },
    ]);
    expect(
      splitExampleHostLinks("asl.com.lb", CLEARANCE_BROKER_EXAMPLE_HOSTS),
    ).toEqual([
      { kind: "link", value: "asl.com.lb", href: "https://asl.com.lb" },
    ]);
  });
});
