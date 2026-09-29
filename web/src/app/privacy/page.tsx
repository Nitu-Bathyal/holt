import type { Metadata } from "next";
import Link from "next/link";
import { ContactEmail, LegalPage } from "@/components/legal-page";
import { CONTACT_CITY, PAYMENT_BRAND } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What Holt stores about you (very little), what it sends to AI providers and payment processors, and how to have it deleted.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalPage
      rail="privacy"
      title={<>Privacy Policy</>}
      lede="Holt stores as little about you as it can, never sells data, and shows no ads. This page says exactly what we keep, why, and how to have it removed."
    >
      <div className="summary">
        <p><strong>The short version.</strong></p>
        <ul>
          <li>Holt reads public GitHub data. It never posts anything and never gets access to your repositories.</li>
          <li>If you sign in, we keep your name, email and profile picture from GitHub or Google, and your report history. Nothing else from either account. See <a href="#google" className="text-link">signing in with Google</a>.</li>
          <li>We don&rsquo;t store API keys, and we don&rsquo;t keep the access tokens GitHub or Google hand back at sign-in.</li>
          <li>Payments are handled by Razorpay (INR) and Dodo Payments (USD). Card details never reach us.</li>
          <li>One cookie to keep you signed in, one setting for your theme. Visits are counted by our own analytics, which sets no cookie and runs on our server. No ads, no third-party trackers, no selling data.</li>
          <li>Connecting your GitHub account is optional and for adults only. If you do, we note which repos you view here and may count your public contributions, anonymously, in repo statistics unless you <a href="#connect-github" className="text-link">opt out</a>.</li>
          <li>Email us and we&rsquo;ll delete your account and everything tied to it.</li>
        </ul>
      </div>

      <h2>1. Who is responsible</h2>
      <p>
        Holt at githolt.com is run by an individual based in {CONTACT_CITY}, India, as a sole proprietorship. For any question about your data, email <ContactEmail />.
      </p>

      <h2>2. What we collect and why</h2>

      <h3>If you only visit</h3>
      <ul>
        <li><strong>Your IP address</strong> is used to rate-limit anonymous requests so one person can&rsquo;t overload the service. The limiter keeps it in memory for up to an hour. IP addresses also appear in ordinary server and proxy logs for a short time, which we use only to keep the site running.</li>
        <li><strong>The repositories you look up</strong> are recorded as analysis jobs. For visitors who aren&rsquo;t signed in, a job isn&rsquo;t tied to a person.</li>
        <li><strong>A daily count of requests.</strong> Each time someone asks for a report or runs a search, we note the day, the repository and a scrambled code made from your IP address (or your account, if you&rsquo;re signed in). The code changes every day, so it tells us how many different people used Holt on a given day, but not who they are, and it can&rsquo;t link your visits across days. The IP address itself isn&rsquo;t stored.</li>
        <li><strong>Visit counts</strong> from our own analytics. See <a href="#analytics" className="text-link">section 5</a>.</li>
      </ul>

      <h3>If you sign in</h3>
      <ul>
        <li><strong>Your name, email address and profile-picture link</strong> from GitHub or Google, and nothing else from either account. Sections 3 and 4 say exactly what each provider gives us and how to take it back.</li>
        <li><strong>The sign-in library&rsquo;s records:</strong> the provider&rsquo;s ID for your account, so it can recognise you next time. The access tokens GitHub or Google return at sign-in are thrown away, not stored.</li>
        <li><strong>Your analyses and history:</strong> which repositories you checked, when, in which mode, and the resulting reports, so your history page works.</li>
        <li id="profile"><strong>Your profile, if you fill one in:</strong> the languages, topics, time, kinds of contribution and experience you choose, and when you confirmed you&rsquo;re 18 or older, used only to pre-fill your searches; delete it any time in <Link href="/settings/privacy" className="text-link">settings</Link>.</li>
        <li id="saved"><strong>Repos you save:</strong> which repositories you saved and when, so your <Link href="/me/repos?show=saved" className="text-link">saved list</Link> works. Unsave one any time; deleting your account deletes the list.</li>
        <li><strong>Your free AI reports:</strong> how many you have left, when you last claimed one, a record of each one given, used or given back, and your plan.</li>
      </ul>

      <h3>If you pay for something</h3>
      <ul>
        <li>The processor (Razorpay for INR, Dodo Payments for USD) collects your payment details. <strong>We never see or store card, UPI or bank details.</strong></li>
        <li>We receive and keep what we need to run your plan: your name and email, what you bought, the amount and currency, the payment or subscription ID, and its status. Receipts show the name <strong>{PAYMENT_BRAND}</strong>.</li>
        <li>For USD purchases, Dodo Payments is the merchant of record and handles the transaction under its own privacy policy.</li>
      </ul>

      <h3>If you email us</h3>
      <p>We keep the email and our reply for as long as we need them to deal with your request.</p>

      <h2 id="google">3. Signing in with Google</h2>
      <p>
        You can sign in to Holt with a Google account. This section says exactly what that involves. It applies on top of everything else on this page.
      </p>
      <h3>What Holt receives from Google</h3>
      <p>
        When you choose &ldquo;Sign in with Google&rdquo;, Holt asks Google for the three basic sign-in scopes, <strong>openid</strong>, <strong>email</strong> and{" "}
        <strong>profile</strong>, and nothing more. Through them Google gives Holt:
      </p>
      <ul>
        <li>your <strong>name</strong>,</li>
        <li>your <strong>email address</strong> (and whether Google has verified it),</li>
        <li>the <strong>link to your profile picture</strong>,</li>
        <li>and Google&rsquo;s ID for your account, so Holt can recognise you next time.</li>
      </ul>
      <p>
        That is all. Holt has <strong>no access to your Gmail, Google Drive, Calendar, Contacts, Photos, YouTube or any other Google data</strong>, and it
        never asks for it. Holt can&rsquo;t read, send, change or delete anything in your Google account.
      </p>
      <h3>What it&rsquo;s used for</h3>
      <p>
        Only to <strong>create and identify your Holt account</strong> and to <strong>show your name and picture in the header</strong> when you&rsquo;re signed in.
        Your email address is also how we recognise you if you write to us about your account. We don&rsquo;t send marketing email.
      </p>
      <h3>What it&rsquo;s never used for</h3>
      <ul>
        <li>It is <strong>never sold</strong>.</li>
        <li>It is <strong>never shared</strong> with anyone except the services listed in section 8, and only as far as running Holt needs (for example, your name and email go to the payment processor if you buy a plan).</li>
        <li>It is <strong>never used for advertising</strong>, and Holt shows no ads.</li>
        <li>It is <strong>never used to train AI models</strong>, ours or anyone else&rsquo;s. AI reports never include anything about you (see section 7).</li>
        <li>No human at Holt reads it except to answer a request you&rsquo;ve made, or to keep the service running.</li>
      </ul>
      <h3>Where it&rsquo;s stored and for how long</h3>
      <p>
        Your name, email and picture link are kept in Holt&rsquo;s own database, on the server described in section 8, alongside the sign-in library&rsquo;s
        record of your Google account ID. They are kept <strong>until you delete your account</strong> (see below) and are not
        copied anywhere else. The access token Google returns at sign-in is not stored, so Holt can&rsquo;t fetch anything further from Google.
      </p>
      <h3 id="protection">How we protect it</h3>
      <p>These are the actual measures in place today, not aspirations. We don&rsquo;t hold any security certification and don&rsquo;t claim one.</p>
      <ul>
        <li><strong>Encrypted in transit.</strong> githolt.com is served only over HTTPS through Cloudflare, and the connection from Cloudflare to our server is an encrypted Cloudflare tunnel. Your details are encrypted the whole way from your browser to our server.</li>
        <li><strong>The database isn&rsquo;t reachable from the internet.</strong> It runs in a container on a private network on the server, with no public port. Only the app can talk to it, and the app itself is reachable only through the tunnel.</li>
        <li><strong>Access is limited to one person.</strong> The person running Holt is the only one with access to the server, the database and the backups. There is no team, and no third party has an account on the server.</li>
        <li><strong>Secrets are kept out of the code.</strong> Sign-in credentials, database passwords and encryption keys live in files on the server that are outside the source code and readable only by the operator. Holt&rsquo;s code is open source, and no secret is in it.</li>
        <li><strong>No keys or tokens to leak.</strong> Holt doesn&rsquo;t store API keys, or the GitHub and Google access tokens from sign-in.</li>
        <li><strong>Backups are nightly and restricted.</strong> A copy of the database is taken every night, stored on the server with permissions that allow only the operator to read it, and deleted after 14 days. So after you delete your account, your details can remain in a backup for up to 14 days and are then gone.</li>
        <li><strong>What we don&rsquo;t claim:</strong> the database files themselves are not separately encrypted at rest beyond the protections above, and we don&rsquo;t promise that no system can ever fail. If you find a weakness, section 11 says how to tell us.</li>
      </ul>
      <h3>How to take it back</h3>
      <ul>
        <li>
          <strong>Revoke Holt&rsquo;s access</strong> at any time from your Google account&rsquo;s permissions page:{" "}
          <a href="https://myaccount.google.com/permissions" className="text-link" rel="noopener noreferrer">myaccount.google.com/permissions</a>. Holt then
          can&rsquo;t sign you in with Google until you allow it again.
        </li>
        <li>
          <strong>Have your data deleted</strong> by emailing <ContactEmail /> from the address on your account. We remove your account, the Google details
          above and your history. Revoking access at Google doesn&rsquo;t delete your Holt account by itself, so do both if you want everything gone.
        </li>
      </ul>
      <p>
        Holt&rsquo;s use and transfer of information received from Google APIs adheres to the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" className="text-link" rel="noopener noreferrer">Google API Services User Data Policy</a>,
        including the Limited Use requirements.
      </p>

      <h2 id="github">4. Signing in with GitHub</h2>
      <p>
        Signing in with GitHub works the same way. Holt asks GitHub only for your <strong>public profile</strong> and your <strong>email address</strong> (the
        read:user and user:email scopes) and receives your name, email, profile-picture link and GitHub account ID. It gets <strong>no access to your repositories</strong>,
        public or private, and can&rsquo;t star, comment, open pull requests or do anything else on your behalf. The data is used, stored and deleted exactly as
        described for Google above. You can revoke Holt&rsquo;s access at any time under{" "}
        <a href="https://github.com/settings/applications" className="text-link" rel="noopener noreferrer">GitHub settings &rarr; Applications</a>, and email us to delete your account.
      </p>

      <h3 id="connect-github">Connecting your GitHub account</h3>
      <p>
        Connecting GitHub is optional, free, and only for people 18 or older. You do it on the Connect GitHub screen, which says in one line:
        &ldquo;Connecting lets Holt track your public contributions and include them anonymously in repo statistics (shown only when 5+ people
        contribute).&rdquo; Connecting is how you agree to that; the switch below is how you say no to the statistics part.
      </p>
      <ul>
        <li><strong>Why:</strong> to show you your own public pull requests with Holt&rsquo;s verdict on each repo, to tell whether you opened a pull request soon after checking a repo on Holt, and to count your public contributions, without your name, in statistics about a repo. A repo&rsquo;s statistics are shown only when 5 or more people&rsquo;s contributions are in them.</li>
        <li><strong>What we store:</strong> your GitHub account ID and username, when you connected, when you confirmed you&rsquo;re 18 or older, whether you chose &ldquo;Don&rsquo;t include me in statistics&rdquo;, and, while you&rsquo;re connected, which repos&rsquo; report pages you opened on Holt (the repo, the first and last time, and how many times) and your public pull requests to other people&rsquo;s repos from the last 12 months (repo, number, title, link, whether it was merged or closed, and the dates), refreshed daily.</li>
        <li><strong>How we read GitHub:</strong> only public data, with Holt&rsquo;s own access, never yours. Confirming your GitHub account asks GitHub for the same as signing in with it (your public profile and email address), no new permissions, and Holt can&rsquo;t post, comment or open anything as you.</li>
        <li><strong>Leaving statistics out:</strong> turn on &ldquo;Don&rsquo;t include me in statistics&rdquo; on the Connect screen or in your <Link href="/settings/privacy" className="text-link">settings</Link>, at any time. Your contributions are left out of every repo&rsquo;s numbers from then on.</li>
        <li><strong>Disconnecting:</strong> the disconnect button in settings deletes the connection, the list of repos you viewed and your saved pull requests, straight away. If you also sign in with Google, the link between your GitHub account and your Holt account is removed too.</li>
        <li><strong>Deleting everything:</strong> email <ContactEmail /> and we&rsquo;ll delete your account and everything above with it.</li>
      </ul>

      <h2>5. Cookies and browser storage</h2>
      <ul>
        <li><strong>One session cookie</strong>, set only when you sign in, so you stay signed in. It contains a random token, not your details. If you skip the profile card, a second cookie remembers that for a year.</li>
        <li><strong>Small settings in your browser&rsquo;s local storage:</strong> your light or dark theme choice, and whether you closed the Hacktoberfest banner. These never leave your browser.</li>
      </ul>
      <p>That&rsquo;s all. There are no advertising cookies, no third-party analytics scripts, and no tracking pixels.</p>

      <h3 id="analytics">How we count visits</h3>
      <p>
        We count visits with <strong>Umami</strong>, an open-source analytics tool that we run ourselves, on the same server as Holt. Its script is
        loaded from githolt.com and sends its counts only to githolt.com. No analytics company receives anything.
      </p>
      <ul>
        <li><strong>No cookies and nothing stored in your browser.</strong> That is why there is no cookie banner.</li>
        <li><strong>What it records:</strong> the page you opened and the page you came from, your browser, operating system, device type, screen size and language, your country and approximate city (worked out from your IP address), and a few actions: pasting a repository, opening a report (with its verdict), opening a suggested starter issue, running a search and choosing a sign-in button.</li>
        <li><strong>Not you.</strong> To tell one visitor from another, Umami combines your IP address and browser details into a scrambled code that changes every month. It doesn&rsquo;t store your IP address, and nothing it records is tied to your account, name or email.</li>
        <li>If your browser blocks the script, Holt works exactly the same.</li>
      </ul>

      <h2>6. Public GitHub data and reports</h2>
      <p>
        Holt fetches public repositories, pull requests and comments through GitHub&rsquo;s API. Reports are cached and shown publicly
        at githolt.com so the next person gets an answer instantly. A report is about how a project treats outside contributors.
        It may quote and link to public pull requests, including the public GitHub usernames on them, because every finding must be
        checkable at its source. Holt adds nothing that wasn&rsquo;t already public on GitHub.
      </p>
      <p>
        If you are a maintainer or contributor and believe a report quotes something it shouldn&rsquo;t, email us and we&rsquo;ll look at it.
      </p>

      <h2>7. AI providers</h2>
      <p>
        AI reports are optional. The verdict is computed by rules without a model. When you ask for an AI explanation, Holt sends the
        model the evidence it collected: excerpts of public pull-request titles, comments and metadata from the repository being
        analysed, plus Holt&rsquo;s own findings. <strong>Nothing about you</strong> (no name, email or account information) is included.
      </p>
      <ul>
        <li>Requests go through <strong>OpenRouter</strong>, on Holt&rsquo;s own account, which routes them to the vendor of the model Holt uses (currently an OpenAI, Google or Anthropic model). OpenRouter&rsquo;s and that vendor&rsquo;s policies apply to those requests.</li>
      </ul>

      <h2>8. Who else sees data</h2>
      <p>We don&rsquo;t sell data, and we don&rsquo;t share it with anyone for advertising. The services that touch data in order to run Holt are:</p>
      <ul>
        <li><strong>GitHub</strong>: we read public data through its API. GitHub and Google also handle sign-in.</li>
        <li><strong>Razorpay</strong> and <strong>Dodo Payments</strong>: payments, as described above.</li>
        <li><strong>OpenRouter</strong> and the AI model vendors: only for AI reports, as described above.</li>
        <li><strong>Cloudflare</strong>: DNS and the connection to our server, so it sees the same request data any web proxy does.</li>
        <li><strong>Our hosting provider</strong>: the server and database run there.</li>
      </ul>
      <p>We&rsquo;ll also disclose data if the law requires it, and we&rsquo;ll tell you when we&rsquo;re allowed to.</p>

      <h2>9. How long we keep things</h2>
      <ul>
        <li>Account details and your history: until you delete them or ask us to.</li>
        <li>Rate-limit records: up to an hour, in memory.</li>
        <li>The daily request counts and the visit counts: kept to see how Holt is used over time. Neither contains your IP address or anything that identifies you.</li>
        <li>Cached reports: kept so public report pages load fast and so we can see how a project changes over time. They contain public GitHub data, not account data.</li>
        <li>Payment records: as long as Indian tax and accounting rules require.</li>
      </ul>

      <h2>10. Your rights and how to delete your data</h2>
      <p>
        You can ask us to show you what we hold about you, correct it, or delete it. To delete your account, email <ContactEmail /> from
        the address on your account, and we&rsquo;ll remove your account and history. Cached public reports stay, because they
        contain no account data.
      </p>
      <p>
        We follow India&rsquo;s Digital Personal Data Protection Act, 2023. If you&rsquo;re somewhere with other privacy laws, such as the EU or the UK,
        the same rights apply in practice: ask, and we&rsquo;ll act on it.
      </p>

      <h2>11. Security</h2>
      <p>
        Everything travels over HTTPS. The database has no public port and is reached only through the app. We store no API keys or sign-in access tokens.
        Access to the server, database and backups is limited to the person running Holt. The full list of measures is under{" "}
        <a href="#protection" className="text-link">how we protect it</a> in section 3; it applies to everything we store, not only Google data.
        No system is perfect, so if you find a weakness, please email us before posting it publicly and we&rsquo;ll fix it fast.
      </p>

      <h2>12. Children</h2>
      <p>Holt is not for children under 13, and we don&rsquo;t knowingly keep data about them. If you think a child has an account, email us and we&rsquo;ll remove it.</p>

      <h2>13. Changes</h2>
      <p>
        If this policy changes, the date at the top will change with it, and we&rsquo;ll flag significant changes on the site. See also the{" "}
        <Link href="/terms" className="text-link">terms of service</Link> and the <Link href="/refunds" className="text-link">refund policy</Link>.
      </p>

      <h2>14. Contact</h2>
      <p>Email <ContactEmail />. Details are on the <Link href="/contact" className="text-link">contact page</Link>.</p>
    </LegalPage>
  );
}
