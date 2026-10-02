/** The "coming soon" chip (the pricing page's): what stands where a feature that isn't switched on yet would be offered. */
export function ComingSoon({ small = false, className = "" }: { small?: boolean; className?: string }) {
  return (
    <span className={`chip shrink-0 whitespace-nowrap border-amber/60 text-amber ${small ? "min-h-0 px-1.5 py-[3px] text-[0.68rem] leading-none" : ""} ${className}`} data-coming-soon>
      coming soon
    </span>
  );
}
