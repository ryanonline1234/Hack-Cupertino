/**
 * Decorative city skyline for the landing hero — SVG silhouette, no external assets.
 */
export function SkylineBackdrop() {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-[min(52vh,520px)] select-none [filter:drop-shadow(0_-6px_32px_rgba(34,211,238,0.14))]"
      aria-hidden
    >
      <svg
        className="h-full w-full text-[#1a2638]"
        viewBox="0 0 1200 240"
        preserveAspectRatio="xMidYMax slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="skyline-silhouette" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.78" />
            <stop offset="55%" stopColor="currentColor" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#0a0f18" stopOpacity="1" />
          </linearGradient>
          <linearGradient id="skyline-glow" x1="50%" y1="100%" x2="50%" y2="0%">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.22" />
            <stop offset="45%" stopColor="#a855f7" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#050816" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Ambient glow behind buildings */}
        <ellipse cx="600" cy="228" rx="560" ry="100" fill="url(#skyline-glow)" />
        {/* Building mass — taller / more varied profile for stronger read */}
        <path
          fill="url(#skyline-silhouette)"
          d="
            M0,240 L0,128 L32,128 L32,98 L58,98 L58,118 L86,118 L86,78 L112,78 L112,104 L142,104 L142,62
            L188,62 L188,96 L220,96 L220,68 L262,68 L262,112 L292,112 L292,82 L328,82 L328,42 L376,42
            L376,88 L410,88 L410,64 L452,64 L452,102 L486,102 L486,58 L542,58 L542,96 L582,96 L582,72
            L622,72 L622,110 L658,110 L658,36 L688,36 L688,78 L738,78 L738,52 L782,52 L782,100 L822,100
            L822,68 L862,68 L862,114 L902,114 L902,76 L948,76 L948,54 L1002,54 L1002,94 L1042,94 L1042,70
            L1082,70 L1082,108 L1122,108 L1122,82 L1168,82 L1168,124 L1200,124 L1200,240 Z
          "
        />
        {/* Lit windows — slightly brighter for prominence */}
        <g fill="#5ee9ff" opacity="0.26">
          <rect x="340" y="54" width="7" height="9" rx="1" />
          <rect x="352" y="72" width="7" height="9" rx="1" />
          <rect x="518" y="72" width="7" height="9" rx="1" />
          <rect x="668" y="52" width="9" height="11" rx="1" />
          <rect x="684" y="70" width="7" height="9" rx="1" />
          <rect x="908" y="66" width="7" height="9" rx="1" />
          <rect x="922" y="86" width="7" height="9" rx="1" />
          <rect x="1088" y="88" width="7" height="9" rx="1" />
          <rect x="118" y="78" width="6" height="8" rx="1" />
          <rect x="792" y="62" width="7" height="9" rx="1" />
        </g>
        <g fill="#e9a8ff" opacity="0.2">
          <rect x="228" y="74" width="6" height="7" rx="1" />
          <rect x="432" y="78" width="6" height="7" rx="1" />
          <rect x="872" y="90" width="6" height="7" rx="1" />
        </g>
      </svg>
    </div>
  );
}
