import type { Metadata } from "next";
import Link from "next/link";
import { packs, plans } from "@/lib/api";
import { creditsLabel, expiryLine, formatPrice, packToBuy, planFeatureLine } from "@/lib/payments";
import { currentUser } from "@/lib/session";
import { EXAMPLE_PATH } from "@/lib/example-report";
import { CLAIM_EVERY_DAYS, WELCOME_AI_CREDITS } from "@/lib/site";
import { BuyPack } from "@/components/buy-pack";
import { SubscribePlan } from "@/components/subscribe-plan";
import { PageHead } from "@/components/page-head";
import { PageTransition } from "@/components/motion/page-transition";

export const metadata: Metadata = {
  title: "Pricing",
  description: `Checking a repo is free, forever. Sign in for ${WELCOME_AI_CREDITS} free AI reports, plus 1 more every week.`,
  alternates: { canonical: "/pricing" },
};

const PLANS = [
  {
    name: "Free",
    price: "$0",
    tag: "forever",
    body: "Everything you need to pick a project.",
    items: ["Unlimited rules reports with a free account", "Starter issues and evidence", "Find, compare, badges and share images"],
    cta: { href: "/", label: "check a repo" },
    accent: "border-line-strong",
  },
  {
    name: "Free AI",
    price: "$0",
    tag: `${WELCOME_AI_CREDITS} AI reports to start`,
    body: "Plain-English explanations, on us.",
    items: [
      `${WELCOME_AI_CREDITS} AI reports when you sign in`,
      `Claim 1 more every ${CLAIM_EVERY_DAYS} days`,
      "A written explanation, every quote checked and linked to GitHub",
      "Your report history",
    ],
    cta: { href: "/signin", label: `sign in for ${WELCOME_AI_CREDITS} free AI reports` },
    example: true,
    accent: "border-blue",
    featured: true,
  },
];

const SOON = [
  { name: "Student Pro", body: "More AI reports each month." },
  { name: "Clubs & classrooms", body: "One shared pool of AI reports for a college club or a course." },
];

export default async function PricingPage({ searchParams }: PageProps<"/pricing">) {
  // Credit packs and monthly plans appear only while the server has them on
  // sale (each has its own switch there).
  const [sale, monthly, user, sp] = await Promise.all([packs(), plans(), currentUser(), searchParams]);
  const onSale = sale.ok && sale.data.on_sale ? sale.data.packs : [];
  const plansOnSale = monthly.ok && monthly.data.on_sale ? monthly.data.plans : [];
  const buy = packToBuy(sp.buy, onSale);
  const subscribeTo = packToBuy(sp.subscribe, plansOnSale);
  return (
    <PageTransition>
      <>
      <PageHead>
        <p className="rail mb-4 flex gap-2"><strong className="m-0">pricing</strong><span>free where it matters</span></p>
        <h1 className="display max-w-3xl text-[clamp(2rem,6vw,3.4rem)]">
          Finding a project is free. <span className="text-green">It always will be.</span>
        </h1>
        <p className="prose-sans mt-5 max-w-2xl text-[1.05rem]">
          Money never changes a verdict. AI writes the explanation. The rules still decide.
        </p>
      </PageHead>

      <div className="wrap py-10 sm:py-14">
        <ul className="grid gap-4 md:grid-cols-2">
          {PLANS.map((p) => (
            <li key={p.name} className={`relative flex flex-col border bg-panel p-6 ${p.accent} ${p.featured ? "shadow-card" : "shadow-soft"}`}>
              {p.featured && <span className="absolute -top-3 left-6 bg-blue px-2 py-0.5 text-[0.78rem] font-semibold text-on-accent">start here</span>}
              <p className="text-[0.85rem] uppercase tracking-[0.08em] text-faint">{p.name}</p>
              <p className="mt-3 text-[2.4rem] font-semibold leading-none tracking-tight">
                {p.price} <span className="text-[0.89rem] font-normal tracking-normal text-muted">{p.tag}</span>
              </p>
              <p className="mt-3 font-sans text-muted">{p.body}</p>
              <ul className="mt-5 flex-1 space-y-2 font-sans text-[0.92rem]">
                {p.items.map((i) => (
                  <li key={i} className="flex gap-2"><span aria-hidden="true" className="text-green">✓</span>{i}</li>
                ))}
              </ul>
              <Link href={p.cta.href} className="btn-ghost mt-6 w-full">{p.cta.label} →</Link>
              {p.example && (
                <Link href={EXAMPLE_PATH} className="text-link tap mt-3 text-center font-sans text-[0.9rem]" data-example-link>
                  or read an example AI report first
                </Link>
              )}
            </li>
          ))}
        </ul>

        {onSale.length > 0 && (
          <section id="packs" aria-labelledby="packs-h" className="mt-14 scroll-mt-24">
            <h2 id="packs-h" className="text-[1.2rem] font-semibold tracking-tight">Credit packs</h2>
            <p className="mt-2 max-w-2xl font-sans text-[0.95rem] text-muted">
              Pay once. No subscription. Credits cover AI reports and paid extras once your free reports run out.
            </p>
            <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {onSale.map((p, i) => (
                <li key={p.id} className="flex flex-col border border-line-strong bg-panel p-6 shadow-soft">
                  <p className="text-[0.85rem] uppercase tracking-[0.08em] text-faint">{p.name}</p>
                  <p className="mt-3 text-[2.4rem] font-semibold leading-none tracking-tight">
                    {formatPrice(p.amount, p.currency)} <span className="text-[0.89rem] font-normal tracking-normal text-muted">once</span>
                  </p>
                  <ul className="mt-5 flex-1 space-y-2 font-sans text-[0.92rem]">
                    <li className="flex gap-2"><span aria-hidden="true" className="text-green">✓</span>{creditsLabel(p.credits)}</li>
                    <li className="flex gap-2"><span aria-hidden="true" className="text-green">✓</span>{expiryLine(p)}</li>
                  </ul>
                  <BuyPack
                    pack={p.id}
                    label={`buy ${creditsLabel(p.credits)} →`}
                    signedIn={Boolean(user)}
                    prefill={{ name: user?.name, email: user?.email }}
                    autoStart={buy === p.id}
                    primary={i === 0}
                  />
                </li>
              ))}
            </ul>
            <p className="mt-4 max-w-2xl font-sans text-[0.89rem] text-muted">
              Paid in INR through Razorpay (UPI, cards, netbanking), billed as <span className="text-ink">Githolt</span>. See the{" "}
              <Link href="/refunds" className="text-link">refund policy</Link>.
            </p>
          </section>
        )}

        <div className="band-alt mt-14 py-10">
        <h2 id="plans" className="scroll-mt-24 text-[1.2rem] font-semibold tracking-tight">Paid plans</h2>
        {plansOnSale.length > 0 && (
          <ul className="mt-4 grid gap-4 sm:grid-cols-2">
            {plansOnSale.map((p) => (
              <li key={p.id} className="flex flex-col border border-green bg-panel p-6 shadow-card">
                <p className="text-[0.85rem] uppercase tracking-[0.08em] text-faint">{p.name}</p>
                <p className="mt-3 text-[2.4rem] font-semibold leading-none tracking-tight">
                  {formatPrice(p.amount, p.currency)} <span className="text-[0.89rem] font-normal tracking-normal text-muted">a month</span>
                </p>
                <ul className="mt-5 flex-1 space-y-2 font-sans text-[0.92rem]">
                  {p.features.map((f) => (
                    <li key={f.id} className="flex gap-2"><span aria-hidden="true" className="text-green">✓</span>{planFeatureLine(f)}</li>
                  ))}
                  <li className="flex gap-2"><span aria-hidden="true" className="text-green">✓</span>Cancel anytime in Settings</li>
                </ul>
                <SubscribePlan
                  plan={p.id}
                  label={`subscribe for ${formatPrice(p.amount, p.currency)} a month →`}
                  signedIn={Boolean(user)}
                  prefill={{ name: user?.name, email: user?.email }}
                  autoStart={subscribeTo === p.id}
                />
              </li>
            ))}
          </ul>
        )}
        <ul className="mt-4 grid gap-4 sm:grid-cols-2">
          {SOON.filter((s) => !(plansOnSale.length > 0 && s.name === "Student Pro")).map((s) => (
            <li key={s.name} className="border border-dashed border-line-strong bg-panel/60 p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold">{s.name}</p>
                <span className="chip border-amber/60 text-amber">coming soon</span>
              </div>
              <p className="mt-2 font-sans text-[0.92rem] text-muted">{s.body}</p>
            </li>
          ))}
        </ul>
        <p className="mt-6 max-w-2xl font-sans text-[0.9rem] text-muted">
          Paid plans bill as <span className="text-ink">Githolt</span>, in INR through Razorpay or in USD through Dodo Payments.
          Cancel any time and keep access until the paid period ends. Details in the{" "}
          <Link href="/refunds" className="text-link">refund and cancellation policy</Link>.
        </p>
        <p className="mt-8 font-sans text-[0.95rem] text-muted">
          Still deciding? <Link href="/" className="bracket-link">[ check a repo for free → ]</Link>
        </p>
        </div>
      </div>
      </>
    </PageTransition>
  );
}
