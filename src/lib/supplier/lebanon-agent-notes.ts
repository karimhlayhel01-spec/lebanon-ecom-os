/**
 * WAVE-3 — static Lebanon sourcing-agent / clearance-broker example notes.
 * Coaching copy only. Not supplier cards. Not Discovery.
 */

export const IMPORT_SOURCING_EXAMPLE_HOSTS = [
  "nourexpress.me",
  "chinatolebanon.com",
  "picknship.net",
  "chinagatelb.com",
] as const;

export const CLEARANCE_BROKER_EXAMPLE_HOSTS = [
  "asl.com.lb",
  "oceanlink-lb.com",
  "chami.co",
] as const;

export type ExampleLinkPart =
  | { kind: "text"; value: string }
  | { kind: "link"; value: string; href: string };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Split prose so only allow-listed https hosts become links. */
export function splitExampleHostLinks(
  text: string,
  hosts: readonly string[],
): ExampleLinkPart[] {
  if (!text || hosts.length === 0) return [{ kind: "text", value: text }];
  const allow = new Map(hosts.map((h) => [h.toLowerCase(), h]));
  const re = new RegExp(`(${hosts.map(escapeRegExp).join("|")})`, "gi");
  const parts: ExampleLinkPart[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) != null) {
    if (m.index > last) {
      parts.push({ kind: "text", value: text.slice(last, m.index) });
    }
    const matched = m[1] ?? "";
    const canonical = allow.get(matched.toLowerCase());
    if (canonical) {
      parts.push({
        kind: "link",
        value: matched,
        href: `https://${canonical}`,
      });
    } else {
      parts.push({ kind: "text", value: matched });
    }
    last = m.index + matched.length;
  }
  if (last < text.length) {
    parts.push({ kind: "text", value: text.slice(last) });
  }
  return parts.length > 0 ? parts : [{ kind: "text", value: text }];
}

/** Import tab + Both (Import in view). Hide on Local-only. */
export function shouldShowImportSourcingAgentNote(
  tab: "import" | "local" | "both",
): boolean {
  return tab === "import" || tab === "both";
}
