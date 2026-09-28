// The sidebar's icons: 16px line drawings on a 24px grid, one stroke weight,
// drawn in currentColor so they take the item's colour.
import type { IconName } from "@/lib/shell";

const PATHS: Record<IconName | "menu" | "close" | "fold" | "github", React.ReactNode> = {
  home: <path d="M4 11l8-7 8 7M6 9.5V20h12V9.5M10 20v-6h4v6" />,
  check: <><path d="M4 5h16v14H4z" /><path d="M8 10l2.5 2.5L8 15M13 15h3" /></>,
  find: <><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></>,
  browse: <path d="M4 5h16M4 10h16M4 15h10M4 20h7" />,
  compare: <path d="M4 5h6v14H4zM14 5h6v14h-6z" />,
  leaf: <><path d="M5 19C5 10 11 5 20 4c0 9-5 15-14 15z" /><path d="M5 19l8-8" /></>,
  pr: <><circle cx="6" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="18" r="2" /><path d="M6 8v8M18 16V9a3 3 0 0 0-3-3h-4M13 4l-2 2 2 2" /></>,
  "pr-check": <><circle cx="6" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><path d="M6 8v8M13 13l2.5 2.5L20 11" /></>,
  saved: <path d="M6 4h12v16l-6-4-6 4z" />,
  history: <><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" /><path d="M12 8v4l3 2" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /></>,
  help: <><circle cx="12" cy="12" r="8.5" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14M12 17h.01" /></>,
  signout: <path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  fold: <path d="M4 4v16M15 7l-5 5 5 5M10 12h10" />,
  github: <path d="M9 19c-4 1.5-4-2-6-2.5M15 21v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12 12 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21" />,
};

export function Icon({ name, className = "size-4" }: { name: keyof typeof PATHS; className?: string }) {
  return (
    <svg className={`shrink-0 ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
