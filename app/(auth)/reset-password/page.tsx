import { UpdatePasswordForm } from "@/components/auth/password-reset-form";
import { typography } from "@/components/ui/variants";

export default function ResetPasswordPage() {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <h1 className={typography.h1}>Choose a new password</h1>
      <p className="mt-2 text-sm leading-6 text-slate-500">Use at least 8 characters.</p>
      <div className="mt-6"><UpdatePasswordForm /></div>
    </section>
  );
}
