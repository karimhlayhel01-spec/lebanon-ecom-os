export type WorkspaceNameLocale = "en" | "ar";

/**
 * Locale-aware default store title from the founder's first name.
 * Last name is intentionally unused.
 */
export function defaultWorkspaceName({
  firstName,
  locale,
}: {
  firstName: string;
  locale: WorkspaceNameLocale;
}): string {
  const trimmed = firstName.trim();
  if (!trimmed) {
    return locale === "ar" ? "متجري" : "My Store";
  }
  return locale === "ar" ? `متجر ${trimmed}` : `${trimmed}'s Store`;
}

/** Map workspace.language (en | ar | both) to a concrete name locale. */
export function resolveWorkspaceNameLocale(
  language: string,
  fallback: WorkspaceNameLocale = "en",
): WorkspaceNameLocale {
  if (language === "ar") return "ar";
  if (language === "en") return "en";
  return fallback;
}

/**
 * True when the workspace still has an auto-generated (or legacy) name
 * derived from the previous first name — safe to refresh on rename.
 */
export function isAutoDefaultWorkspaceName(
  currentName: string,
  previousFirstName: string,
): boolean {
  // Legacy hard-coded titles from before named workspaces.
  if (currentName === "My Store" || currentName === "Preview Store") return true;
  const en = defaultWorkspaceName({
    firstName: previousFirstName,
    locale: "en",
  });
  const ar = defaultWorkspaceName({
    firstName: previousFirstName,
    locale: "ar",
  });
  return currentName === en || currentName === ar;
}

/** Keep `users.name` in sync for session / legacy readers. */
export function fullDisplayName(firstName: string, lastName: string): string {
  return `${firstName.trim()} ${lastName.trim()}`.trim();
}
