import type { Metadata } from "next";
import Link from "next/link";
import { ContactEmail, LegalPage } from "@/components/legal-page";
import { CONTACT_CITY, CONTACT_EMAIL, GITHUB_REPO_URL, PAYMENT_BRAND } from "@/lib/site";

export const metadata: Metadata = {
  title: "Contact",
  description: "How to reach the people who run Holt: refunds, account deletion, privacy questions, problems with a report, and security issues.",
  alternates: { canonical: "/contact" },
};

const REASONS = [
  { what: "Refund or cancellation", how: "You can cancel from your account settings, or by email. For a refund, include the payment ID from your Razorpay or Dodo Payments receipt and the email on your account.", href: "/refunds", label: "refund policy" },
  { what: "Delete your account", how: "Email from the address on your account. We remove the account, your history and any stored AI key.", href: "/privacy", label: "privacy policy" },
  { what: "A question about your data", how: "Ask what we hold, or ask for a correction. We'll answer in plain English." },
  { what: "A report looks wrong", how: "Send the repo link. Every finding links to its source, so tell us which one doesn't hold up." },
  { what: "A security problem", how: "Email before posting it publicly. We'll confirm we got it and fix it as fast as we can." },
];

const TEAM = [
  { name: "Aahil Khan", github: "aahil-khan" },
  { name: "Ishpuneet Singh", github: "ips610" },
  { name: "Anoushka Awasthi", github: "anoushkawasthi" },
];

export default function ContactPage() {
  return (
    <LegalPage
      rail="contact"
      title={<>Contact</>}
      lede="Email is the fastest way in, and every message gets a reply."
    >
      <h2>Email</h2>
      <p className="text-[1.15rem]">
        <ContactEmail />
      </p>
      <p>Expect a reply within 3 business days. Usually sooner.</p>

      <h2>What to write about</h2>
      <ul>
        {REASONS.map((r) => (
          <li key={r.what}>
            <strong>{r.what}.</strong> {r.how}
            {r.href && (
              <>
                {" "}See the <Link href={r.href} className="text-link">{r.label}</Link>.
              </>
            )}
          </li>
        ))}
      </ul>

      <h2>Bugs and ideas</h2>
      <p>
        Holt is open source. Open an issue at{" "}
        <a href={`${GITHUB_REPO_URL}/issues`} className="text-link">github.com/holt-oss/holt/issues</a> so others can see it and chime in.
      </p>

      <h2>Who you&rsquo;re writing to</h2>
      <ul>
        <li><strong>Business name:</strong> Holt. Payments appear as <strong>{PAYMENT_BRAND}</strong> on statements and receipts.</li>
        <li><strong>Based in:</strong> {CONTACT_CITY}, India.</li>
        <li><strong>Email:</strong> {CONTACT_EMAIL}</li>
        <li><strong>Website:</strong> githolt.com</li>
      </ul>
      <h2 id="team">Team</h2>
      <ul>
        {TEAM.map((p) => (
          <li key={p.github}>
            {p.name} &middot; <a href={`https://github.com/${p.github}`} className="text-link">@{p.github}</a>
          </li>
        ))}
      </ul>

      <p>
        Holt is not affiliated with GitHub. Questions about a GitHub account or repository itself should go to GitHub or the project&rsquo;s maintainers.
      </p>
    </LegalPage>
  );
}
