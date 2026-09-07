import { BrandMark } from "@/components/brand/brand-mark";

/**
 * The approved sign-in composition: one 400px column centred in the viewport,
 * the mark above the card rather than inside it. Deliberately identical on
 * every width — an auth screen has nothing to spread across a desktop canvas.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-slate-50 px-6 py-8">
      <div className="screen-enter w-full max-w-[400px]">
        <div className="mb-9 flex justify-center"><BrandMark /></div>
        {children}
      </div>
    </main>
  );
}
