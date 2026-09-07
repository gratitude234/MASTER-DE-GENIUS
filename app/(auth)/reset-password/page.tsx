import { UpdatePasswordForm } from "@/components/auth/password-reset-form";
import { typography } from "@/components/ui/variants";

export default function ResetPasswordPage() {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white px-7 py-8">
      <h1 className={typography.h1}>Choose a new password</h1>
      <p className="mt-1.5 text-[13.5px] leading-[1.5] text-slate-600">Use at least 8 characters.</p>
      <div className="mt-6"><UpdatePasswordForm /></div>
    </section>
  );
}
