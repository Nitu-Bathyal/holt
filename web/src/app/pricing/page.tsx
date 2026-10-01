import type { Metadata } from "next";
import Link from "next/link";
import { passes } from "@/lib/api";
import { formatPrice, passFeatureLine, passToBuy, perMonth } from "@/lib/payments";
import { currentUser } from "@/lib/session";
import { BuyPass } from "@/components/buy-pass";
import { PageHead } from "@/components/page-head";
import { PageTransition } from "@/components/motion/page-transition";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Finding a project on Holt is free, and always will be.",
  alternates: { canonical: "/pricing" },
};

const FREE = ["Unlimited reports with a free account", "Starter issues and evidence", "Find, compare, badges and share images"];

const Tick = ({ children }: { children: React.ReactNode }) => (
  <li className="flex gap-2"><span aria-hidden="true" className="text-green">✓</span>{children}</li>
);

export default async function PricingPage({ searchParams }: PageProps<"/pricing">) {
  // Passes appear only while the server has them on sale (payments switched
  // on, a price set); until then Pro shows as coming, with no price.
  const [sale, user, sp] = await Promise.all([passes(), currentUser(), searchParams]);
  const onSale = sale.ok && sale.data.on_sale ? sale.data.passes : [];
  const features = sale.ok ? sale.data.features : [];
  const buy = passToBuy(sp.buy, onSale);
  const featured = onSale.find((p) => p.days === 90)?.id ?? onSale[0]?.id;
  return (
    <PageTransition>
      <>
      <PageHead>
        <p className="rail mb-4 flex gap-2"><strong className="m-0">pricing</strong><span>free where it matters</span></p>
        <h1 className="display max-w-3xl text-[clamp(1.9rem,4.5vw,3rem)]">
          Finding a project is free. <span className="text-green">It always will be.</span>
        </h1>
        <p className="prose-sans mt-5 max-w-2xl text-[0.98rem]">Money never changes a verdict.</p>
      </PageHead>

      <div className="wrap py-8 sm:py-10">
        <ul className="grid gap-4 md:grid-cols-2">
          <li className="relative flex flex-col border border-blue bg-panel p-6 shadow-card">
            <p className="text-[0.85rem] uppercase tracking-[0.08em] text-faint">Free</p>
            <p className="mt-3 text-[2rem] font-semibold leading-none tracking-tight">
              $0 <span className="text-[0.89rem] font-normal tracking-normal text-muted">forever</span>
            </p>
            <p className="mt-3 font-sans text-muted">Everything you need to pick a project.</p>
            <ul className="mt-5 flex-1 space-y-2 font-sans text-[0.92rem]">
              {FREE.map((i) => <Tick key={i}>{i}</Tick>)}
            </ul>
            <Link href="/" className="btn-primary mt-6 w-full">check a repo →</Link>
          </li>

          {onSale.length === 0 ? (
            <li className="flex flex-col border border-dashed border-line-strong bg-panel/60 p-6">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[0.85rem] uppercase tracking-[0.08em] text-faint">Pro</p>
                <span className="chip border-amber/60 text-amber">coming soon</span>
              </div>
              <p className="mt-3 text-[1.3rem] font-semibold leading-tight tracking-tight">Holt watches for you.</p>
              <p className="mt-3 font-sans text-muted">Your PRs, the repos you follow and the issues you want, plus a plan for getting merged.</p>
            </li>
          ) : (
            <li className="flex flex-col border border-green bg-panel p-6 shadow-card">
              <p className="text-[0.85rem] uppercase tracking-[0.08em] text-faint">Pro</p>
              <p className="mt-3 text-[1.3rem] font-semibold leading-tight tracking-tight">Holt watches for you.</p>
              <ul className="mt-5 flex-1 space-y-2 font-sans text-[0.92rem]">
                {features.map((f) => <Tick key={f.id}>{passFeatureLine(f)}</Tick>)}
              </ul>
              <a href="#passes" className="btn-ghost mt-6 w-full">choose a pass →</a>
            </li>
          )}
        </ul>

        {onSale.length > 0 && (
          <section id="passes" aria-labelledby="passes-h" className="mt-10 scroll-mt-24">
            <h2 id="passes-h" className="text-[1.2rem] font-semibold tracking-tight">Pro passes</h2>
            <p className="mt-2 max-w-2xl font-sans text-[0.95rem] text-muted">One payment. It doesn&apos;t renew.</p>
            <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {onSale.map((p) => {
                const monthly = perMonth(p.amount, p.days, p.currency);
                const top = p.id === featured;
                return (
                  <li key={p.id} className={`relative flex flex-col border bg-panel p-6 ${top ? "border-green shadow-card" : "border-line-strong shadow-soft"}`}>
                    {top && <span className="absolute -top-3 left-6 bg-green px-2 py-0.5 text-[0.78rem] font-semibold text-on-accent">a full season</span>}
                    <p className="text-[0.85rem] uppercase tracking-[0.08em] text-faint">{p.name}</p>
                    <p className="mt-3 text-[2rem] font-semibold leading-none tracking-tight">{formatPrice(p.amount, p.currency)}</p>
                    <p className="mt-2 min-h-[1.4rem] font-sans text-[0.9rem] text-muted">{monthly}</p>
                    <BuyPass
                      pass={p.id}
                      label={`get Pro for ${p.name} →`}
                      signedIn={Boolean(user)}
                      prefill={{ name: user?.name, email: user?.email }}
                      autoStart={buy === p.id}
                      primary={top}
                    />
                  </li>
                );
              })}
            </ul>
            <p className="mt-4 max-w-2xl font-sans text-[0.89rem] text-muted">
              Paid in INR through Razorpay (UPI, cards, netbanking), billed as <span className="text-ink">Githolt</span>. See the{" "}
              <Link href="/refunds" className="text-green transition-opacity hover:opacity-75">refund policy</Link>.
            </p>
          </section>
        )}
      </div>
      </>
    </PageTransition>
  );
}
