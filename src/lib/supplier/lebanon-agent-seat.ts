/**
 * WAVE-3 §3.6 — Use-this-agent Import seat (directory, not live_search).
 * Hosts stay the §3.5 allow-list. Not Discovery. Not clearance brokers.
 */

import { IMPORT_SOURCING_EXAMPLE_HOSTS } from "@/lib/supplier/lebanon-agent-notes";

export const LEBANON_AGENT_PLATFORM = "lebanon_agent";
export const LEBANON_AGENT_LEAD_SOURCE = "directory";
/** Outside Import 3+2 ranks 0–2 so grouping is unchanged. */
export const LEBANON_AGENT_SEAT_RANK = 90;

export type ImportSourcingAgent = {
  name: string;
  host: (typeof IMPORT_SOURCING_EXAMPLE_HOSTS)[number];
};

export const IMPORT_SOURCING_AGENT_DIRECTORY: readonly ImportSourcingAgent[] = [
  { name: "Nour Express", host: "nourexpress.me" },
  { name: "China to Lebanon", host: "chinatolebanon.com" },
  { name: "Pick N Ship", host: "picknship.net" },
  { name: "China Gate", host: "chinagatelb.com" },
] as const;

const HOST_SET = new Set<string>(IMPORT_SOURCING_EXAMPLE_HOSTS);

export function isLebanonAgentPlatform(
  platform: string | null | undefined,
): boolean {
  return platform === LEBANON_AGENT_PLATFORM;
}

export function agentNameForHost(host: string): string | null {
  const row = IMPORT_SOURCING_AGENT_DIRECTORY.find(
    (a) => a.host === host.toLowerCase(),
  );
  return row?.name ?? null;
}

function canonicalAllowListedHost(hostname: string): string | null {
  const host = hostname.trim().toLowerCase().replace(/^www\./, "");
  if (!HOST_SET.has(host)) return null;
  return host;
}

/**
 * Allow-listed https origin only. Rejects other hosts, credentials, and
 * non-http(s) schemes. http on an allow-listed host is upgraded to https.
 */
export function sanitiseAllowListedAgentHttpsUrl(
  raw: string | null | undefined,
): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(
      /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`,
    );
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (parsed.username || parsed.password) return null;
  const host = canonicalAllowListedHost(parsed.hostname);
  if (!host) return null;
  return `https://${host}`;
}

export function hostFromAgentSourceUrl(
  url: string | null | undefined,
): string | null {
  const sanitised = sanitiseAllowListedAgentHttpsUrl(url);
  if (!sanitised) return null;
  try {
    return new URL(sanitised).hostname;
  } catch {
    return null;
  }
}

export type UseLebanonAgentSeatPlan =
  | { kind: "insert" }
  | { kind: "keep"; existingId: string }
  | { kind: "replace"; existingId: string }
  | { kind: "blocked"; existingId: string };

/**
 * At most one lebanon_agent seat per SKU.
 * Same host → keep. Other host, no sample → replace. Sample on seat → block.
 */
export function planUseLebanonAgentSeat(input: {
  canonicalUrl: string;
  existing: { id: string; sourceUrl: string | null } | null;
  hasSample: boolean;
}): UseLebanonAgentSeatPlan {
  if (!input.existing) return { kind: "insert" };
  const existingHost = hostFromAgentSourceUrl(input.existing.sourceUrl);
  const nextHost = hostFromAgentSourceUrl(input.canonicalUrl);
  if (existingHost && nextHost && existingHost === nextHost) {
    return { kind: "keep", existingId: input.existing.id };
  }
  if (input.hasSample) {
    return { kind: "blocked", existingId: input.existing.id };
  }
  return { kind: "replace", existingId: input.existing.id };
}

export type UndoLebanonAgentSeatPlan =
  | { kind: "noop" }
  | { kind: "delete"; existingId: string }
  | { kind: "blocked"; existingId: string };

/**
 * Undo removes the directory seat only. Sample on that seat → block
 * (in-flight or approved). No seat → noop.
 */
export function planUndoLebanonAgentSeat(input: {
  existing: { id: string } | null;
  hasSample: boolean;
}): UndoLebanonAgentSeatPlan {
  if (!input.existing) return { kind: "noop" };
  if (input.hasSample) {
    return { kind: "blocked", existingId: input.existing.id };
  }
  return { kind: "delete", existingId: input.existing.id };
}

/** After a successful undo, no agent is seated. Blocked undo keeps the host. */
export function seatedHostAfterUndo(input: {
  seatedHost: string | null;
  plan: UndoLebanonAgentSeatPlan;
}): string | null {
  if (input.plan.kind === "blocked") return input.seatedHost;
  return null;
}

/** Undo may delete lebanon_agent directory rows only — never live Import listings. */
export function undoLebanonAgentDeleteIds(
  suppliers: readonly { id: string; platform?: string | null }[],
): string[] {
  return suppliers
    .filter((s) => isLebanonAgentPlatform(s.platform))
    .map((s) => s.id);
}

export function lebanonAgentNegotiationDraft(productName: string): string {
  const product = productName.trim() || "this product";
  return [
    `Subject: Sample request — ${product}`,
    ``,
    `Hello,`,
    ``,
    `We are a retailer in Lebanon. We would like you to source and ship ONE paid`,
    `sample of ${product} so we can inspect quality before any bulk order.`,
    ``,
    `Please confirm availability, sample cost, and whether door-to-door includes`,
    `duties or duties are billed separately.`,
    ``,
    `Thank you.`,
  ].join("\n");
}

export type LebanonAgentSeatRowValues = {
  name: string;
  role: "primary";
  rank: number;
  source: "import";
  years: number;
  rating: number;
  verified: boolean;
  moq: number;
  unitPrice: number;
  sampleReplies: boolean;
  negotiationDraft: string;
  paymentMapEstimate: string;
  redFlags: string[];
  leadSource: typeof LEBANON_AGENT_LEAD_SOURCE;
  platform: typeof LEBANON_AGENT_PLATFORM;
  sourceUrl: string;
  externalTitle: null;
};

/** Directory seat: no invent unit / MOQ / stars. */
export function buildLebanonAgentSeatValues(input: {
  name: string;
  sourceUrl: string;
  productName: string;
}): LebanonAgentSeatRowValues {
  return {
    name: input.name,
    role: "primary",
    rank: LEBANON_AGENT_SEAT_RANK,
    source: "import",
    years: 0,
    rating: 0,
    verified: false,
    moq: 0,
    unitPrice: 0,
    sampleReplies: true,
    negotiationDraft: lebanonAgentNegotiationDraft(input.productName),
    paymentMapEstimate: JSON.stringify({
      depositPct: 0,
      balancePct: 0,
      method: "",
      estDeposit: 0,
      note: "",
    }),
    redFlags: [],
    leadSource: LEBANON_AGENT_LEAD_SOURCE,
    platform: LEBANON_AGENT_PLATFORM,
    sourceUrl: input.sourceUrl,
    externalTitle: null,
  };
}

export function importCostQuoteCopyKeys(pathPlatform: string | null): {
  intro: "costQuotesIntro" | "costQuotesIntroAgent";
  freight: "costQuotesGuideFreight" | "costQuotesGuideFreightAgent";
  clearance: "costQuotesGuideClearance" | "costQuotesGuideClearanceAgent";
} {
  if (isLebanonAgentPlatform(pathPlatform)) {
    return {
      intro: "costQuotesIntroAgent",
      freight: "costQuotesGuideFreightAgent",
      clearance: "costQuotesGuideClearanceAgent",
    };
  }
  return {
    intro: "costQuotesIntro",
    freight: "costQuotesGuideFreight",
    clearance: "costQuotesGuideClearance",
  };
}
