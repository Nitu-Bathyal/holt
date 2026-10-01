// The bell, in the sidebar icons' drawing (lines on a 24px grid, one stroke
// weight, currentColor). `off` strikes it through.
export function BellIcon({ off = false, className = "size-5" }: { off?: boolean; className?: string }) {
  return (
    <svg className={`shrink-0 ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" />
      <path d="M10 21a2.2 2.2 0 0 0 4 0" />
      {off && <path d="M4 4l16 16" />}
    </svg>
  );
}
