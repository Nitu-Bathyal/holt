/** The owner's GitHub avatar over their initial, which shows if the image can't load. */
export function RepoAvatar({ repo, size = 32 }: { repo: string; size?: number }) {
  const owner = repo.split("/")[0];
  return (
    <span aria-hidden="true" className="relative grid shrink-0 place-items-center overflow-hidden rounded-md border border-line-strong bg-panel-2 text-[0.8rem] font-semibold uppercase text-faint" style={{ width: size, height: size }}>
      {owner.slice(0, 1)}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`https://github.com/${owner}.png?size=${size * 2}`} alt="" width={size} height={size} loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover" />
    </span>
  );
}

export function LangDot({ color }: { color: string | null }) {
  return <span aria-hidden="true" className="inline-block size-2.5 shrink-0 rounded-full border border-line-strong" style={color ? { background: color, borderColor: "transparent" } : undefined} />;
}
