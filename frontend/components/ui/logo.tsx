export function CapsuleLogo({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={Math.round(size * 1.45)}
      viewBox="0 0 100 145"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="capsule-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#4f46e5" />
        </linearGradient>
        <clipPath id="capsule-clip">
          <rect x="6" y="6" width="88" height="133" rx="44" />
        </clipPath>
      </defs>
      {/* outer shell */}
      <rect x="0" y="0" width="100" height="145" rx="50" fill="url(#capsule-grad)" />
      {/* white inner ring */}
      <rect x="6" y="6" width="88" height="133" rx="44" fill="none" stroke="white" strokeWidth="3" strokeOpacity="0.9" />
      {/* grid */}
      <g clipPath="url(#capsule-clip)" opacity="0.18">
        {[20,35,50,65,80].map(x => <line key={`v${x}`} x1={x} y1="6" x2={x} y2="139" stroke="white" strokeWidth="1"/>)}
        {[24,39,54,69,84,99,114].map(y => <line key={`h${y}`} x1="6" y1={y} x2="94" y2={y} stroke="white" strokeWidth="1"/>)}
      </g>
      {/* PCB trace */}
      <g clipPath="url(#capsule-clip)" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        {/* top pads */}
        <circle cx="43" cy="32" r="4" fill="white" />
        <circle cx="61" cy="32" r="4" fill="white" />
        {/* trace */}
        <polyline points="43,32 43,52 52,52 52,63 61,63 61,84 52,84 52,95 61,95 61,113" fill="none" />
        <polyline points="61,32 61,52" fill="none" />
        {/* bottom pads */}
        <circle cx="43" cy="113" r="4" fill="white" />
        <circle cx="61" cy="113" r="4" fill="white" />
        <polyline points="43,95 43,113" fill="none" />
      </g>
    </svg>
  )
}
