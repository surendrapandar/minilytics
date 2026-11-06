export function Logo({ small = false }: { small?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <svg width={small ? 24 : 28} height={small ? 24 : 28} viewBox="0 0 32 32">
        <rect width="32" height="32" rx="8" fill="#1c1917" className="dark:stroke-stone-300" strokeWidth="1" />
        <path d="M8 22l5-7 4 4 7-10" stroke="#e07b5f" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className={`font-semibold tracking-tight ${small ? 'text-base' : 'text-lg'}`}>Minilytics</span>
    </div>
  );
}
