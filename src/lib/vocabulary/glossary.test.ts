import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GLOSSARY,
  GLOSSARY_TERM_IDS,
  VOCAB_PHASES,
  resolveHubVocabHighlightPhase,
  resolveVocabHighlightPhase,
  termsForPhase,
} from "@/lib/vocabulary/glossary";

function loadMessages(locale: "en" | "ar") {
  const raw = readFileSync(
    join(process.cwd(), "messages", `${locale}.json`),
    "utf8",
  );
  return JSON.parse(raw) as {
    Vocabulary: {
      terms: Record<
        string,
        {
          term: string;
          meaning: string;
          definition: string;
          why: Record<string, string>;
        }
      >;
      phases: Record<string, string>;
    };
  };
}

describe("resolveVocabHighlightPhase", () => {
  it("maps primary journey states to vocab phases", () => {
    expect(resolveVocabHighlightPhase("discovery")).toBe("discovery");
    expect(resolveVocabHighlightPhase("supplier_sample")).toBe(
      "sample_request",
    );
    expect(resolveVocabHighlightPhase("sample_approved")).toBe(
      "sample_approved",
    );
    expect(resolveVocabHighlightPhase("store_setup")).toBe("store_setup");
    expect(resolveVocabHighlightPhase("batch_ordered")).toBe("batch_ordered");
    expect(resolveVocabHighlightPhase("batch_arrived_ready")).toBe(
      "batch_received",
    );
    expect(resolveVocabHighlightPhase("selling")).toBe("selling");
  });

  it("uses pausedFromState when paused", () => {
    expect(
      resolveVocabHighlightPhase("paused", "batch_ordered"),
    ).toBe("batch_ordered");
  });

  it("returns null for blocked, missing pause source, or unknown", () => {
    expect(resolveVocabHighlightPhase("blocked")).toBeNull();
    expect(resolveVocabHighlightPhase("blocked", "discovery")).toBeNull();
    expect(resolveVocabHighlightPhase("paused", null)).toBeNull();
    expect(resolveVocabHighlightPhase("paused")).toBeNull();
    expect(resolveVocabHighlightPhase("unknown_state")).toBeNull();
    expect(resolveVocabHighlightPhase(null)).toBeNull();
  });
});

describe("resolveHubVocabHighlightPhase", () => {
  it("prefers active live SKU even when others differ", () => {
    expect(
      resolveHubVocabHighlightPhase(
        [
          { id: "a", primaryState: "supplier_sample" },
          { id: "b", primaryState: "selling" },
        ],
        "b",
      ),
    ).toBe("selling");
  });

  it("returns shared phase when every live SKU agrees and no active", () => {
    expect(
      resolveHubVocabHighlightPhase(
        [
          { id: "a", primaryState: "batch_ordered" },
          { id: "b", primaryState: "batch_ordered" },
        ],
        null,
      ),
    ).toBe("batch_ordered");
  });

  it("returns null when stages are mixed and active is missing", () => {
    expect(
      resolveHubVocabHighlightPhase(
        [
          { id: "a", primaryState: "supplier_sample" },
          { id: "b", primaryState: "selling" },
        ],
        null,
      ),
    ).toBeNull();
  });

  it("uses discovery when there are no live SKUs", () => {
    expect(resolveHubVocabHighlightPhase([], null)).toBe("discovery");
  });
});

describe("glossary coverage", () => {
  it("lists every term id exactly once", () => {
    const ids = GLOSSARY.map((e) => e.id);
    expect(ids).toEqual([...new Set(ids)]);
    expect(new Set(ids)).toEqual(new Set(GLOSSARY_TERM_IDS));
  });

  it("keeps all seven phases populated", () => {
    for (const phase of VOCAB_PHASES) {
      expect(termsForPhase(phase).length).toBeGreaterThan(0);
    }
  });

  it("requires distinct multi-phase why copy in EN and AR", () => {
    const multiPhase = GLOSSARY.filter((e) => e.phases.length > 1);
    expect(multiPhase.map((e) => e.id)).toEqual(
      expect.arrayContaining([
        "sku",
        "landedCost",
        "marginBeforeAds",
        "marginAfterAds",
        "moq",
        "cod",
        "inventory",
        "approvalGate",
        "workingSupplier",
        "warmedSpare",
        "backupSupplier",
        "primarySupplier",
        "addSku",
        "importVsLocal",
      ]),
    );

    for (const locale of ["en", "ar"] as const) {
      const vocab = loadMessages(locale).Vocabulary;
      for (const entry of multiPhase) {
        const whys = entry.phases.map((phase) => vocab.terms[entry.id].why[phase]);
        expect(whys.every(Boolean)).toBe(true);
        expect(new Set(whys).size).toBe(whys.length);
      }
    }
  });

  it("keeps EN/AR key parity for every glossary term", () => {
    const en = loadMessages("en").Vocabulary;
    const ar = loadMessages("ar").Vocabulary;

    for (const phase of VOCAB_PHASES) {
      expect(en.phases[phase]).toBeTruthy();
      expect(ar.phases[phase]).toBeTruthy();
    }

    for (const entry of GLOSSARY) {
      const enTerm = en.terms[entry.id];
      const arTerm = ar.terms[entry.id];
      expect(enTerm?.term).toBeTruthy();
      expect(arTerm?.term).toBe(enTerm.term);
      expect(enTerm.meaning).toBeTruthy();
      expect(arTerm.meaning).toBeTruthy();
      expect(enTerm.definition).toBeTruthy();
      expect(arTerm.definition).toBeTruthy();
      for (const phase of entry.phases) {
        expect(enTerm.why[phase]).toBeTruthy();
        expect(arTerm.why[phase]).toBeTruthy();
      }
    }
  });
});
