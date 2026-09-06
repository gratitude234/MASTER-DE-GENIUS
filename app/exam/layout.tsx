import { requireOnboardedUser } from "@/lib/auth";

export default async function ExamLayout({ children }: { children: React.ReactNode }) {
  await requireOnboardedUser();
  return children;
}
