// The Nanote app icon (iN monogram) as a scalable inline SVG.
export function AppIcon({ size = 64, className, rounded = true }: { size?: number; className?: string; rounded?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      className={className}
      role="img"
      aria-label="Nanote"
    >
      <defs>
        <linearGradient id="nanote-icon-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2B7BFF" />
          <stop offset="0.55" stopColor="#1E6FF2" />
          <stop offset="1" stopColor="#0D47C4" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx={rounded ? 123 : 40} fill="url(#nanote-icon-g)" />
      <path
        d="M186 354 L186 158 L326 354 L326 158"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="58"
        strokeLinejoin="miter"
        strokeLinecap="butt"
      />
      <circle cx="110" cy="175" r="30" fill="#FFFFFF" />
    </svg>
  );
}

/** Wordmark used on onboarding/about. */
export function AppWordmark({ size = 44 }: { size?: number }) {
  return (
    <div className="flex items-center gap-3">
      <AppIcon size={size} />
      <span className="font-bold tracking-tight" style={{ fontSize: size * 0.62 }}>
        Nanote
      </span>
    </div>
  );
}
