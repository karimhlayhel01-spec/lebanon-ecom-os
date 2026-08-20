"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  acknowledgeDiscoveryIntroAction,
  beginAgentExploreMoreAction,
  submitAgentAskStepAction,
  submitAgentExploreWhyAction,
} from "@/actions/discovery";
import {
  AGENT_AUDIENCE_CHIPS,
  AGENT_DIFFER_CHIPS,
  AGENT_OTHER_MAX_CHARS,
  AGENT_SKIP_REFUSE_CHIPS,
  AGENT_WHY_CHIPS,
  type AgentAudienceChip,
  type AgentDifferChip,
  type AgentFrame,
  type AgentWhyChip,
} from "@/lib/discovery/agent/frame";
import {
  INDUSTRY_OPTIONS,
  type IndustryOptionId,
} from "@/lib/constants";

export function DiscoveryAgentIntro() {
  const t = useTranslations("Discovery");
  const ind = useTranslations("Onboarding");
  const [pending, start] = useTransition();

  return (
    <div className="surface-card p-6" data-discovery-agent-intro="">
      <h3 className="font-display text-lg text-ink">{t("agentIntroTitle")}</h3>
      <p className="mt-2 max-w-2xl text-sm text-stone-dark">
        {t("agentIntroBody")}
      </p>
      <ul className="mt-3 grid gap-1 text-sm text-ink sm:grid-cols-2">
        {INDUSTRY_OPTIONS.map((id) => (
          <li key={id}>{ind(`industries.${id}`)}</li>
        ))}
      </ul>
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => { await acknowledgeDiscoveryIntroAction(); })}
        className="mt-4 rounded-md bg-cedar px-5 py-2.5 text-sm font-semibold text-foam shadow-sm transition hover:bg-cedar-deep disabled:opacity-60"
      >
        {t("agentIntroNext")}
      </button>
    </div>
  );
}

export function DiscoveryAgentAsk({
  frame,
  onboardingIndustryLikes,
  skipAllowed = true,
  keepCandidateIds = [],
}: {
  frame: AgentFrame;
  onboardingIndustryLikes: readonly string[];
  skipAllowed?: boolean;
  keepCandidateIds?: readonly string[];
}) {
  const step = frame.askStep;
  if (step <= 0) {
    return (
      <AskSellCard
        frame={frame}
        onboardingIndustryLikes={onboardingIndustryLikes}
        keepCandidateIds={keepCandidateIds}
      />
    );
  }
  if (step === 1) {
    return (
      <AskSkipRefuseCard
        skipAllowed={skipAllowed}
        keepCandidateIds={keepCandidateIds}
      />
    );
  }
  if (step === 2) {
    return (
      <AskAudienceCard
        skipAllowed={skipAllowed}
        keepCandidateIds={keepCandidateIds}
      />
    );
  }
  return <AskDifferCard keepCandidateIds={keepCandidateIds} />;
}

export function DiscoveryAgentDontDeal() {
  const t = useTranslations("Discovery");
  return (
    <div className="surface-card p-6" data-discovery-agent-dont-deal="">
      <h3 className="font-display text-lg text-ink">{t("agentDontDealTitle")}</h3>
      <p className="mt-2 max-w-2xl text-sm text-stone-dark">
        {t("agentDontDealBody")}
      </p>
    </div>
  );
}

export function DiscoveryAgentNothingFits() {
  const t = useTranslations("Discovery");
  return (
    <div className="surface-card p-6" data-discovery-agent-nothing-fits="">
      <h3 className="font-display text-lg text-ink">
        {t("agentNothingFitsTitle")}
      </h3>
      <p className="mt-2 max-w-2xl text-sm text-stone-dark">
        {t("agentNothingFitsBody")}
      </p>
    </div>
  );
}

export function DiscoveryAgentWhyExplore({
  keepCandidateIds,
}: {
  keepCandidateIds: readonly string[];
}) {
  const t = useTranslations("Discovery");
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  const [why, setWhy] = useState<AgentWhyChip | null>(null);

  return (
    <div className="surface-card p-6" data-discovery-agent-why="">
      <h3 className="font-display text-lg text-ink">{t("agentWhyExploreTitle")}</h3>
      <p className="mt-1 text-sm text-stone-dark">{t("agentWhyExploreHint")}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {AGENT_WHY_CHIPS.map((id) => {
          const on = why === id;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={on}
              disabled={pending}
              onClick={() => setWhy(id)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                on
                  ? "border-cedar bg-cedar/10 text-cedar-deep"
                  : "border-stone bg-surface text-ink hover:bg-sand"
              }`}
            >
              {t(`agentWhyExplore_${id}` as never)}
            </button>
          );
        })}
      </div>
      <label className="mt-4 block text-xs text-stone-dark">
        {t("agentWhyExploreNoteLabel")}
        <input
          value={note}
          maxLength={AGENT_OTHER_MAX_CHARS}
          placeholder={t("agentWhyExploreNotePlaceholder")}
          onChange={(e) => setNote(e.target.value)}
          className="mt-1 w-full rounded-md border border-stone bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-cedar"
        />
      </label>
      <button
        type="button"
        disabled={pending || !why}
        onClick={() =>
          start(async () => {
            if (!why) return;
            await submitAgentExploreWhyAction({
              why,
              note,
              keepCandidateIds,
            });
          })
        }
        className="mt-4 rounded-md bg-cedar px-5 py-2.5 text-sm font-semibold text-foam shadow-sm transition hover:bg-cedar-deep disabled:opacity-60"
      >
        {t("agentWhyExploreContinue")}
      </button>
    </div>
  );
}

export function DiscoveryAgentExploreMoreButton() {
  const t = useTranslations("Discovery");
  const [pending, start] = useTransition();
  return (
    <div className="flex justify-center pt-1">
      <button
        type="button"
        data-discovery-agent-explore-more=""
        disabled={pending}
        onClick={() =>
          start(async () => {
            await beginAgentExploreMoreAction();
          })
        }
        className="rounded-md border border-stone bg-surface px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-sand disabled:opacity-60"
      >
        {t("agentExploreMore")}
      </button>
    </div>
  );
}

export function DiscoveryAgentFrameChips({ frame }: { frame: AgentFrame }) {
  const t = useTranslations("Discovery");
  const ind = useTranslations("Onboarding");
  const chips: { key: string; label: string }[] = frame.industryIds.map(
    (id) => ({
      key: `industry:${id}`,
      label: ind(`industries.${id}`),
    }),
  );
  if (frame.otherText) {
    chips.push({
      key: "other",
      label: `${t("agentAskOtherLabel")}: ${frame.otherText}`,
    });
  }
  if (frame.skipRefuse === "skipped") {
    chips.push({ key: "skipRefuse", label: t("agentChipSkipped") });
  } else if (frame.skipRefuse) {
    chips.push({
      key: "skipRefuse",
      label: t(`agentAskSkipRefuse_${frame.skipRefuse}` as never),
    });
  }
  if (frame.audience === "skipped") {
    chips.push({ key: "audience", label: t("agentChipSkipped") });
  } else if (frame.audience) {
    chips.push({
      key: "audience",
      label: t(`agentAskAudience_${frame.audience}` as never),
    });
  }
  if (frame.differ === "skipped") {
    chips.push({ key: "differ", label: t("agentChipSkipped") });
  } else if (frame.differ) {
    chips.push({
      key: "differ",
      label: t(`agentAskDiffer_${frame.differ}` as never),
    });
  }
  if (frame.whyExplore) {
    chips.push({
      key: "whyExplore",
      label: t(`agentWhyExplore_${frame.whyExplore}` as never),
    });
  }
  if (frame.whyNote) {
    chips.push({ key: "whyNote", label: frame.whyNote });
  }
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2" data-discovery-agent-chips="">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="rounded-full border border-stone bg-sand px-3 py-1 text-xs font-medium text-ink"
        >
          {chip.label}
        </span>
      ))}
    </div>
  );
}

function AskSellCard({
  frame,
  onboardingIndustryLikes,
  keepCandidateIds,
}: {
  frame: AgentFrame;
  onboardingIndustryLikes: readonly string[];
  keepCandidateIds: readonly string[];
}) {
  const t = useTranslations("Discovery");
  const ind = useTranslations("Onboarding");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const prechecked = frame.industryIds.length
    ? frame.industryIds
    : onboardingIndustryLikes.filter((id): id is IndustryOptionId =>
        (INDUSTRY_OPTIONS as readonly string[]).includes(id),
      );
  const [selected, setSelected] = useState<IndustryOptionId[]>(prechecked);
  const [otherText, setOtherText] = useState(frame.otherText);

  function toggle(id: IndustryOptionId) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  return (
    <div className="surface-card p-6" data-discovery-agent-ask="sell">
      <h3 className="font-display text-lg text-ink">{t("agentAskSellTitle")}</h3>
      <p className="mt-1 text-sm text-stone-dark">{t("agentAskSellHint")}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {INDUSTRY_OPTIONS.map((id) => {
          const on = selected.includes(id);
          return (
            <button
              key={id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(id)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                on
                  ? "border-cedar bg-cedar/10 text-cedar-deep"
                  : "border-stone bg-surface text-ink hover:bg-sand"
              }`}
            >
              {ind(`industries.${id}`)}
            </button>
          );
        })}
      </div>
      <label className="mt-4 block text-xs text-stone-dark">
        {t("agentAskOtherLabel")}
        <input
          value={otherText}
          maxLength={AGENT_OTHER_MAX_CHARS}
          placeholder={t("agentAskOtherPlaceholder")}
          onChange={(e) => setOtherText(e.target.value)}
          className="mt-1 w-full rounded-md border border-stone bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-cedar"
        />
      </label>
      {error ? <p className="mt-2 text-xs text-amber-800">{error}</p> : null}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await submitAgentAskStepAction(
              {
                step: "sell",
                industryIds: selected,
                otherText,
              },
              keepCandidateIds,
            );
            if (!res.ok && res.error === "empty_sell") {
              setError(t("agentAskSellEmpty"));
            }
          })
        }
        className="mt-4 rounded-md bg-cedar px-5 py-2.5 text-sm font-semibold text-foam shadow-sm transition hover:bg-cedar-deep disabled:opacity-60"
      >
        {t("agentAskNext")}
      </button>
    </div>
  );
}

function AskSkipRefuseCard({
  skipAllowed,
  keepCandidateIds,
}: {
  skipAllowed: boolean;
  keepCandidateIds: readonly string[];
}) {
  const t = useTranslations("Discovery");
  const [pending, start] = useTransition();
  return (
    <div className="surface-card p-6" data-discovery-agent-ask="skipRefuse">
      <h3 className="font-display text-lg text-ink">
        {t("agentAskSkipRefuseTitle")}
      </h3>
      <p className="mt-1 text-sm text-stone-dark">{t("agentAskSkipRefuseHint")}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {AGENT_SKIP_REFUSE_CHIPS.map((id) => (
          <button
            key={id}
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await submitAgentAskStepAction(
                  {
                    step: "skipRefuse",
                    value: id,
                  },
                  keepCandidateIds,
                );
              })
            }
            className="rounded-full border border-stone bg-surface px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-sand disabled:opacity-60"
          >
            {t(`agentAskSkipRefuse_${id}` as never)}
          </button>
        ))}
      </div>
      {skipAllowed ? (
        <SkipButton
          pending={pending}
          onSkip={() =>
            start(async () => {
              await submitAgentAskStepAction(
                {
                  step: "skipRefuse",
                  value: "skipped",
                },
                keepCandidateIds,
              );
            })
          }
        />
      ) : null}
    </div>
  );
}

function AskAudienceCard({
  skipAllowed,
  keepCandidateIds,
}: {
  skipAllowed: boolean;
  keepCandidateIds: readonly string[];
}) {
  const t = useTranslations("Discovery");
  const [pending, start] = useTransition();
  return (
    <div className="surface-card p-6" data-discovery-agent-ask="audience">
      <h3 className="font-display text-lg text-ink">{t("agentAskAudienceTitle")}</h3>
      <div className="mt-4 flex flex-wrap gap-2">
        {AGENT_AUDIENCE_CHIPS.map((id) => (
          <button
            key={id}
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await submitAgentAskStepAction(
                  {
                    step: "audience",
                    value: id as AgentAudienceChip,
                  },
                  keepCandidateIds,
                );
              })
            }
            className="rounded-full border border-stone bg-surface px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-sand disabled:opacity-60"
          >
            {t(`agentAskAudience_${id}` as never)}
          </button>
        ))}
      </div>
      {skipAllowed ? (
        <SkipButton
          pending={pending}
          onSkip={() =>
            start(async () => {
              await submitAgentAskStepAction(
                {
                  step: "audience",
                  value: "skipped",
                },
                keepCandidateIds,
              );
            })
          }
        />
      ) : null}
    </div>
  );
}

function AskDifferCard({
  keepCandidateIds,
}: {
  keepCandidateIds: readonly string[];
}) {
  const t = useTranslations("Discovery");
  const [pending, start] = useTransition();
  return (
    <div className="surface-card p-6" data-discovery-agent-ask="differ">
      <h3 className="font-display text-lg text-ink">{t("agentAskDifferTitle")}</h3>
      <p className="mt-1 text-sm text-stone-dark">{t("agentAskDifferHint")}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {AGENT_DIFFER_CHIPS.map((id) => (
          <button
            key={id}
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await submitAgentAskStepAction(
                  {
                    step: "differ",
                    value: id as AgentDifferChip,
                  },
                  keepCandidateIds,
                );
              })
            }
            className="rounded-full border border-stone bg-surface px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-sand disabled:opacity-60"
          >
            {t(`agentAskDiffer_${id}` as never)}
          </button>
        ))}
      </div>
    </div>
  );
}

function SkipButton({
  pending,
  onSkip,
}: {
  pending: boolean;
  onSkip: () => void;
}) {
  const t = useTranslations("Discovery");
  return (
    <button
      type="button"
      disabled={pending}
      onClick={onSkip}
      className="mt-4 rounded-md border border-stone px-4 py-2 text-sm font-medium text-ink transition hover:bg-sand disabled:opacity-60"
    >
      {t("agentAskSkip")}
    </button>
  );
}
