import { Link } from "@/i18n/navigation";

export type HeroCta = {
  // May be a route (optionally with a query, e.g. /marketing?stage=launch) or a
  // same-page hash anchor (e.g. #discovery) for scroll-to-content CTAs.
  href: string;
  label: string;
  tone: "primary" | "parallel";
};

function CtaLink({
  href,
  className,
  children,
}: {
  href: string;
  className: string;
  children: React.ReactNode;
}) {
  // Same-page anchors scroll; everything else routes via next-intl Link.
  if (href.startsWith("#")) {
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

/**
 * Full-width stage hero band for the cockpit stages (batch_arrived_ready,
 * selling). Big display title, one coaching subline, and the two parallel
 * Orchestrator actions promoted to real buttons that link to deep routes.
 */
export function StageHero({
  eyebrow,
  title,
  subline,
  ctas,
  whisper,
}: {
  eyebrow: string;
  title: string;
  subline: string;
  ctas: HeroCta[];
  whisper?: { label: string; href: string } | null;
}) {
  return (
    <section className="stage-hero animate-rise mt-4 overflow-hidden px-6 py-8 sm:px-9 sm:py-10">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cedar-deep">
        {eyebrow}
      </p>
      <h1 className="mt-2 max-w-3xl font-display text-3xl leading-tight text-ink sm:text-4xl">
        {title}
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-stone-dark sm:text-base">
        {subline}
      </p>

      {(ctas.length > 0 || whisper) && (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          {ctas.map((cta) => (
            <CtaLink
              key={`${cta.tone}:${cta.label}:${cta.href}`}
              href={cta.href}
              className={
                cta.tone === "primary"
                  ? "hero-cta rounded-md bg-cedar px-5 py-2.5 text-sm font-semibold text-foam shadow-sm hover:bg-cedar-deep"
                  : "hero-cta rounded-md border border-stone/70 bg-transparent px-4 py-2 text-xs font-medium text-stone-dark hover:border-cedar/35 hover:bg-cedar/5 hover:text-cedar-deep"
              }
            >
              {cta.label}
            </CtaLink>
          ))}
          {whisper && (
            <Link
              href={whisper.href}
              className="text-sm font-medium text-sea underline-offset-2 hover:underline"
            >
              {whisper.label} →
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
