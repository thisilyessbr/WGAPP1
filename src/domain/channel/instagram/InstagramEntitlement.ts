export function instagramEntitled(profile: { instagramAllowed?: boolean; planSnapshot?: unknown } | null | undefined): boolean {
  if (!profile?.instagramAllowed) return false;
  const plan = profile.planSnapshot as { modules?: unknown } | null | undefined;
  return Array.isArray(plan?.modules) && plan.modules.includes('instagram');
}
