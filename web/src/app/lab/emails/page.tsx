// /lab/emails: every email Holt sends, on made-up data, as the server renders
// it (HTML and plain text), so the copy and the look can be judged before any
// is sent. Staging and dev only: production answers 404.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { labEmails } from "@/lib/api";
import { EmailLab } from "./_parts/preview";
import "./emails.css";

export const metadata: Metadata = {
  title: "Lab: emails",
  robots: { index: false, follow: false },
};

// Staging is the only production build with ROBOTS_NOINDEX=1 (deploy/README.md).
export const dynamic = "force-dynamic";

export default async function EmailLabPage() {
  if (process.env.NODE_ENV === "production" && process.env.ROBOTS_NOINDEX !== "1") notFound();
  const got = await labEmails();
  return (
    <div className="wrap py-12">
      <h1 className="display text-[clamp(1.6rem,4vw,2.1rem)]">Emails</h1>
      {got.ok ? <EmailLab emails={got.data.emails} /> : <p className="mt-6 text-muted">The server didn&rsquo;t give the emails: {got.error.message}</p>}
    </div>
  );
}
