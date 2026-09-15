export function chooseExamPreference<T extends { is_primary: boolean; exam: { code: string } }>(
 preferences: T[], userId: string, saved?: string, explicitCode?: string,
): T | undefined {
 if (explicitCode !== undefined) {
  const preference = preferences.find(item => item.exam.code === explicitCode);
  if (!preference) throw new Error("Add this exam to your preparation before using it.");
  return preference;
 }
 const selected = preferences.find(item => saved === `${userId}:${item.exam.code}`);
 return selected ?? preferences.find(item => item.is_primary) ?? preferences[0];
}
