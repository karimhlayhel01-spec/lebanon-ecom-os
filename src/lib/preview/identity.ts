import {
  PREVIEW_FIRST_NAME,
  PREVIEW_LAST_NAME,
} from "@/lib/preview/config";
import { defaultWorkspaceName } from "@/lib/workspace-name";

/**
 * Founder/store identity that survives preview stage jumps.
 * Journey, SKU, suppliers, kits, Topic A always reset; this does not.
 */
export type PreviewIdentity = {
  firstName: string;
  lastName: string;
  workspaceName: string;
  language: string;
  uiLanguage: string;
};

export function defaultPreviewIdentity(): PreviewIdentity {
  return {
    firstName: PREVIEW_FIRST_NAME,
    lastName: PREVIEW_LAST_NAME,
    workspaceName: defaultWorkspaceName({
      firstName: PREVIEW_FIRST_NAME,
      locale: "en",
    }),
    language: "en",
    uiLanguage: "en",
  };
}

/** Prefer prior identity across re-seeds; defaults on first-ever seed. */
export function resolvePreviewIdentity(
  prior: PreviewIdentity | null,
): PreviewIdentity {
  if (!prior) return defaultPreviewIdentity();
  const defaults = defaultPreviewIdentity();
  return {
    firstName: prior.firstName.trim() || defaults.firstName,
    lastName: prior.lastName.trim() || defaults.lastName,
    workspaceName: prior.workspaceName.trim() || defaults.workspaceName,
    language: prior.language.trim() || defaults.language,
    uiLanguage: prior.uiLanguage.trim() || defaults.uiLanguage,
  };
}
