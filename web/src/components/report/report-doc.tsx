// A report page's wrapper. The reading type (IBM Plex) is site-wide now
// (app/layout.tsx), so this only keeps a hook for report-specific styles.
export function ReportDoc({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`report-doc ${className}`}>{children}</div>;
}
