import { BrandMark } from "@/components/brand/brand-mark";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center"><BrandMark /></div>
        {children}
      </div>
    </main>
  );
}
