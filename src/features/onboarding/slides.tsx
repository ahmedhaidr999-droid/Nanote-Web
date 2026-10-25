'use client';
// Onboarding slide illustrations — clean line-art using the Nanote palette:
// brand #1E6FF2 · ink #16233A · highlighter #FFD84D. Pure inline SVG, no deps.

export function SlideArt1() {
  // A fountain pen drawing a wavy stroke on ruled paper, with a highlighter swatch.
  return (
    <svg
      width="200"
      height="200"
      viewBox="0 0 200 200"
      role="img"
      aria-hidden="true"
      className="h-[200px] w-[200px] shrink-0"
    >
      {/* paper */}
      <rect x="22" y="38" width="156" height="126" rx="14" fill="#FFFFFF" stroke="#D8E0EC" strokeWidth="3" />
      {/* ruled lines */}
      <g stroke="#E8EEF7" strokeWidth="3" strokeLinecap="round">
        <line x1="42" y1="64" x2="158" y2="64" />
        <line x1="42" y1="84" x2="158" y2="84" />
        <line x1="42" y1="140" x2="112" y2="140" />
      </g>
      {/* highlighter swatch */}
      <path
        d="M44 122 C 72 112, 100 130, 126 120 S 152 112, 158 118"
        fill="none"
        stroke="#FFD84D"
        strokeWidth="11"
        strokeLinecap="round"
      />
      {/* ink wave */}
      <path
        d="M42 100 C 62 80, 82 116, 102 98 S 136 76, 150 94"
        fill="none"
        stroke="#1E6FF2"
        strokeWidth="6"
        strokeLinecap="round"
      />
      {/* pen */}
      <g transform="translate(150 94) rotate(48)">
        <rect x="-6" y="-58" width="12" height="30" rx="6" fill="#1E6FF2" />
        <rect x="-6" y="-58" width="12" height="30" rx="6" fill="none" stroke="#16233A" strokeOpacity="0.14" strokeWidth="2" />
        <path d="M0 0 L7 -16 L0 -26 L-7 -16 Z" fill="#16233A" strokeLinejoin="round" />
        <circle cx="0" cy="-4" r="1.6" fill="#FFFFFF" />
      </g>
      {/* ink droplets */}
      <circle cx="170" cy="110" r="2.4" fill="#1E6FF2" />
      <circle cx="177" cy="102" r="1.6" fill="#1E6FF2" />
      <circle cx="165" cy="118" r="1.4" fill="#1E6FF2" />
    </svg>
  );
}

export function SlideArt2() {
  // Stacked notebook covers over a folder — organized library motif.
  return (
    <svg
      width="200"
      height="200"
      viewBox="0 0 200 200"
      role="img"
      aria-hidden="true"
      className="h-[200px] w-[200px] shrink-0"
    >
      {/* folder behind */}
      <g transform="rotate(-4 100 112)">
        <path
          d="M34 58 h44 l10 10 h78 a10 10 0 0 1 10 10 v70 a10 10 0 0 1 -10 10 h-132 a10 10 0 0 1 -10 -10 v-80 a10 10 0 0 1 10 -10 z"
          fill="#F1F5FB"
          stroke="#D8E0EC"
          strokeWidth="3"
          strokeLinejoin="round"
        />
      </g>
      {/* back notebook — brand */}
      <g transform="rotate(6 100 104)">
        <rect x="52" y="40" width="96" height="124" rx="12" fill="#E8F0FE" stroke="#1E6FF2" strokeWidth="3" />
      </g>
      {/* middle notebook — highlighter */}
      <g transform="rotate(-3 100 106)">
        <rect x="56" y="46" width="96" height="122" rx="12" fill="#FFD84D" />
        <rect x="56" y="46" width="96" height="122" rx="12" fill="none" stroke="#16233A" strokeOpacity="0.14" strokeWidth="3" />
      </g>
      {/* front notebook — paper */}
      <g transform="rotate(2 100 108)">
        <rect x="58" y="52" width="96" height="120" rx="12" fill="#FFFFFF" stroke="#16233A" strokeWidth="3" />
        {/* bookmark ribbon */}
        <path d="M126 52 v18 l-8 -6 l-8 6 v-18 z" fill="#1E6FF2" />
        {/* title lines */}
        <line x1="74" y1="88" x2="138" y2="88" stroke="#16233A" strokeWidth="4" strokeLinecap="round" />
        <line x1="74" y1="102" x2="118" y2="102" stroke="#C4CFDE" strokeWidth="4" strokeLinecap="round" />
        {/* sparkle */}
        <path
          d="M104 124 l4 12 l12 4 l-12 4 l-4 12 l-4 -12 l-12 -4 l12 -4 z"
          fill="#FFD84D"
          stroke="#16233A"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}

export function SlideArt3() {
  // A handwritten document flowing into an export badge.
  return (
    <svg
      width="200"
      height="200"
      viewBox="0 0 200 200"
      role="img"
      aria-hidden="true"
      className="h-[200px] w-[200px] shrink-0"
    >
      {/* document */}
      <rect x="36" y="46" width="102" height="132" rx="12" fill="#FFFFFF" stroke="#16233A" strokeWidth="3" />
      {/* text lines */}
      <g stroke="#C4CFDE" strokeWidth="4" strokeLinecap="round">
        <line x1="54" y1="76" x2="120" y2="76" />
        <line x1="54" y1="94" x2="120" y2="94" />
        <line x1="54" y1="112" x2="100" y2="112" />
      </g>
      {/* highlighted line */}
      <line x1="54" y1="134" x2="118" y2="134" stroke="#FFD84D" strokeWidth="9" strokeLinecap="round" />
      {/* signature squiggle */}
      <path
        d="M54 158 c 8 -10, 14 6, 22 -2 s 12 -8, 18 4"
        fill="none"
        stroke="#1E6FF2"
        strokeWidth="4"
        strokeLinecap="round"
      />
      {/* dotted flow into the badge */}
      <path
        d="M112 104 Q 136 98 142 82"
        fill="none"
        stroke="#1E6FF2"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeDasharray="0.5 8"
      />
      {/* export badge */}
      <circle cx="150" cy="58" r="30" fill="#1E6FF2" />
      <g stroke="#FFFFFF" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M150 70 V46" />
        <path d="M140 56 L150 45 L160 56" />
      </g>
    </svg>
  );
}
