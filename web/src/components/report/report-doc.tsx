// The reading type for reports (free and paid): IBM Plex Sans for text, Plex
// Serif for the verdict and headings, Plex Mono for code. Loaded only where a
// report renders; the site's chrome keeps its own type. Inside the wrapper,
// Tailwind's font-sans / font-serif resolve to Plex (see globals.css).
import { IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Serif } from "next/font/google";

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-plex-sans", display: "swap" });
const serif = IBM_Plex_Serif({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-plex-serif", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono", display: "swap" });

export function ReportDoc({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`report-doc ${sans.variable} ${serif.variable} ${mono.variable} ${className}`}>{children}</div>;
}
