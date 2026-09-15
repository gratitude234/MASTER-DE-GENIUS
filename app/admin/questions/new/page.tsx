import { AdminPageHeader, Panel } from "@/components/admin/admin-ui";
import { QuestionEditor } from "@/components/admin/question-editor";
import { requireAdminPermission } from "@/features/admin/auth";
import { loadQuestionCatalog } from "@/features/admin/questions";

export const dynamic = "force-dynamic";

export default async function NewQuestionPage() {
  await requireAdminPermission("questions.manage");
  const catalog = await loadQuestionCatalog();

  return (
    <div>
      <AdminPageHeader
        title="New question"
        breadcrumbs={[{ href: "/admin/questions", label: "Questions" }]}
        description="Save as draft to review later, or as active to start serving it when the internal bank is the question source."
      />
      <Panel>
        <QuestionEditor catalog={catalog} />
      </Panel>
    </div>
  );
}
