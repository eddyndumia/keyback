// Keyback illustrations. Hand-inked style: ink outlines, flat purple fills,
// slightly uneven lines. All inline SVG so they scale and theme cleanly.
const INK = '#0f141a'
const P6 = '#5b2bc9'
const P3 = '#b59cf5'
const P1 = '#efe9fd'
const GREEN = '#1d8102'
const S = { fill: 'none', stroke: INK, strokeWidth: 2.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

/** The mark: a key whose bow is a return arrow. */
export function Mark({ size = 28, light = false }: { size?: number; light?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill={light ? '#fff' : P6} />
      <g fill="none" stroke={light ? P6 : '#fff'} strokeLinecap="round" strokeLinejoin="round">
        <path d="M15.6 9.2a6 6 0 1 0 2.9 5.6" strokeWidth="2.4" />
        <path d="m15.2 6.4 1.2 3.1-3.2 1" strokeWidth="2.2" />
        <path d="M18.6 15h8.2M24.2 15v3.4M21.6 15v2.4" strokeWidth="2.4" />
      </g>
    </svg>
  )
}

export function Wordmark({ light = false }: { light?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontWeight: 800, fontSize: 20, letterSpacing: '-0.02em', color: light ? '#fff' : INK }}>
      <Mark />
      Keyback
    </span>
  )
}

/** Hero: the flat, the deposit held in the contract, and the money looping back to the tenant. */
export function HeroArt() {
  return (
    <svg className="doodle" viewBox="0 0 560 470" role="img" aria-label="A deposit held in a contract between a flat and the tenant, flowing back when they move out">
      {/* ground shadow */}
      <ellipse cx="290" cy="440" rx="250" ry="14" fill={P1} />

      {/* the flat */}
      <path d="M40 210 L132 132 L226 208" {...S} strokeWidth={3} />
      <path d="M58 196 L60 420 L208 421 L210 196" {...S} fill="#fff" strokeWidth={3} />
      <path d="M58 196 L60 420 L208 421 L210 196" fill="none" />
      <path d="M118 421 L117 336 Q117 326 127 326 L151 326 Q160 326 160 336 L160 421" {...S} fill={P1} />
      <circle cx="151" cy="377" r="3" fill={INK} />
      <path d="M80 236 h38 v34 h-38 z M99 236 v34 M80 253 h38" {...S} fill="#fff" />
      <path d="M150 236 h38 v34 h-38 z M169 236 v34 M150 253 h38" {...S} fill="#fff" />
      <path d="M170 150 v-26 h22 v44" {...S} fill="#fff" />

      {/* keys hanging on the door */}
      <path d="M137 300 q0 -12 0 -18" {...S} strokeWidth={2} />
      <circle cx="137" cy="306" r="7" fill={P3} stroke={INK} strokeWidth={2.2} />
      <path d="M137 313 v14 m0 -5 h5 m-5 4 h4" {...S} strokeWidth={2.2} />

      {/* the contract vault */}
      <g transform="translate(266 222) rotate(-3)">
        <rect x="0" y="0" width="150" height="128" rx="16" fill={P6} stroke={INK} strokeWidth={3} />
        <rect x="14" y="14" width="122" height="100" rx="10" fill="none" stroke="#fff" strokeOpacity=".5" strokeWidth={2} strokeDasharray="5 6" />
        <circle cx="75" cy="64" r="26" fill="#fff" stroke={INK} strokeWidth={3} />
        <path d="M75 46 v10 M75 72 v10 M57 64 h10 M83 64 h10" stroke={INK} strokeWidth={2.5} strokeLinecap="round" />
        <circle cx="75" cy="64" r="5" fill={INK} />
        <path d="M134 40 v48" stroke="#fff" strokeWidth={6} strokeLinecap="round" />
      </g>
      <text x="300" y="384" fontFamily="Monaco, Menlo, monospace" fontSize="13" fill={INK}>deposit.near</text>

      {/* coins going in from the tenant side */}
      <path d="M232 300 C 246 296, 252 290, 262 284" {...S} strokeDasharray="2 8" />

      {/* return loop: contract back to the tenant */}
      <path d="M410 238 C 470 200, 500 140, 452 98 C 418 70, 360 82, 346 118" {...S} stroke={P6} strokeWidth={3.5} />
      <path d="M338 102 L346 122 L364 110" {...S} stroke={P6} strokeWidth={3.5} />
      <g>
        <circle cx="478" cy="160" r="15" fill="#ffd36b" stroke={INK} strokeWidth={2.5} />
        <path d="M478 152 v16 M473 156 q5 -4 10 0 M473 164 q5 4 10 0" {...S} strokeWidth={2} />
        <circle cx="440" cy="84" r="12" fill="#ffd36b" stroke={INK} strokeWidth={2.5} />
        <circle cx="404" cy="78" r="9" fill="#ffd36b" stroke={INK} strokeWidth={2.3} />
      </g>

      {/* the tenant's hand receiving */}
      <path d="M296 150 C 300 128, 318 118, 340 124 L 362 130 C 370 133, 368 144, 360 144 L 336 142" {...S} fill="#fff" />
      <path d="M296 150 C 290 162, 270 164, 252 160" {...S} />

      {/* signed move-in report */}
      <g transform="translate(408 300) rotate(6)">
        <rect x="0" y="0" width="112" height="132" rx="10" fill="#fff" stroke={INK} strokeWidth={3} />
        <rect x="36" y="-10" width="40" height="18" rx="6" fill={P3} stroke={INK} strokeWidth={2.5} />
        <path d="M18 34 l6 6 10 -12 M44 36 h48 M18 62 l6 6 10 -12 M44 64 h48 M18 90 l6 6 10 -12 M44 92 h34" {...S} strokeWidth={2.2} />
        <path d="M58 118 q8 -12 14 -2 q6 8 12 -4 q4 -6 12 0" {...S} stroke={P6} strokeWidth={2.2} />
      </g>

      {/* sparkle marks */}
      <path d="M520 250 v14 M513 257 h14" {...S} stroke={P6} />
      <path d="M248 120 v10 M243 125 h10" {...S} stroke={P6} />
    </svg>
  )
}

/** Step 1: tenant pays into the contract, not to the landlord. */
export function ArtPay() {
  return (
    <svg viewBox="0 0 120 76" aria-hidden="true">
      <rect x="54" y="20" width="56" height="48" rx="9" fill={P6} stroke={INK} strokeWidth={2.5} />
      <circle cx="82" cy="44" r="10" fill="#fff" stroke={INK} strokeWidth={2.5} />
      <circle cx="82" cy="44" r="2.5" fill={INK} />
      <circle cx="22" cy="36" r="13" fill="#ffd36b" stroke={INK} strokeWidth={2.5} />
      <path d="M22 29 v14" {...S} strokeWidth={2} />
      <path d="M38 36 h10 m-5 -5 5 5 -5 5" {...S} />
    </svg>
  )
}

/** Step 2: both sign the same move-in report. */
export function ArtSign() {
  return (
    <svg viewBox="0 0 120 76" aria-hidden="true">
      <rect x="22" y="6" width="58" height="66" rx="7" fill="#fff" stroke={INK} strokeWidth={2.5} />
      <path d="M32 22 l4 4 7 -8 M48 24 h22 M32 40 l4 4 7 -8 M48 42 h22" {...S} strokeWidth={2} />
      <path d="M34 60 q5 -8 9 -1 q4 6 8 -3 M54 60 q4 -7 8 -1 q4 5 8 -2" {...S} stroke={P6} strokeWidth={2} />
      <path d="M86 58 L104 20 L112 24 L94 62 L86 66 Z" fill={P3} stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
    </svg>
  )
}

/** Step 3: moving out, keys handed back. */
export function ArtMoveOut() {
  return (
    <svg viewBox="0 0 120 76" aria-hidden="true">
      <path d="M18 70 V12 Q18 6 24 6 H58 Q64 6 64 12 V70" fill={P1} stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
      <path d="M18 70 L44 62 V2 L18 10" fill="#fff" stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
      <circle cx="38" cy="38" r="2.5" fill={INK} />
      <circle cx="90" cy="30" r="10" fill={P3} stroke={INK} strokeWidth={2.5} />
      <path d="M90 40 v22 m0 -8 h7 m-7 6 h6" {...S} />
      <path d="M70 52 h-6" {...S} />
    </svg>
  )
}

/** Step 4: settle by the rules. */
export function ArtSettle() {
  return (
    <svg viewBox="0 0 120 76" aria-hidden="true">
      <path d="M60 10 V66 M40 68 H80 M24 22 H96" {...S} />
      <circle cx="60" cy="10" r="4" fill={P6} stroke={INK} strokeWidth={2} />
      <path d="M24 22 L12 48 H36 Z" fill={P1} stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
      <path d="M96 22 L84 48 H108 Z" fill={P1} stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
      <circle cx="24" cy="42" r="6" fill="#ffd36b" stroke={INK} strokeWidth={2} />
      <circle cx="92" cy="42" r="6" fill="#ffd36b" stroke={INK} strokeWidth={2} />
      <circle cx="102" cy="42" r="6" fill="#ffd36b" stroke={INK} strokeWidth={2} />
    </svg>
  )
}

/** The assessor in a sealed box: private TEE. */
export function ArtEnclave() {
  return (
    <svg className="doodle" viewBox="0 0 420 300" role="img" aria-label="Two reports go into a sealed box and come out as a signed decision">
      <ellipse cx="210" cy="282" rx="170" ry="10" fill="#1d2430" />
      <g transform="translate(18 70) rotate(-6)">
        <rect width="78" height="96" rx="8" fill="#fff" stroke="#e9ebed" strokeWidth={2.5} />
        <path d="M14 24 h50 M14 42 h50 M14 60 h36" stroke="#5f6b7a" strokeWidth={3} strokeLinecap="round" />
        <text x="14" y="86" fontSize="11" fontFamily="Monaco, monospace" fill={P6}>move-in</text>
      </g>
      <g transform="translate(30 168) rotate(4)">
        <rect width="78" height="96" rx="8" fill="#fff" stroke="#e9ebed" strokeWidth={2.5} />
        <path d="M14 24 h50 M14 42 h50 M14 60 h36" stroke="#5f6b7a" strokeWidth={3} strokeLinecap="round" />
        <text x="14" y="86" fontSize="11" fontFamily="Monaco, monospace" fill={P6}>move-out</text>
      </g>
      <path d="M118 120 C 140 120, 140 150, 152 150 M122 210 C 140 210, 140 170, 152 170" fill="none" stroke={P3} strokeWidth={3} strokeLinecap="round" strokeDasharray="3 7" />
      <rect x="156" y="88" width="120" height="138" rx="16" fill={P6} stroke="#e9ebed" strokeWidth={3} />
      <path d="M186 88 V68 Q186 44 216 44 Q246 44 246 68 V88" fill="none" stroke="#e9ebed" strokeWidth={6} strokeLinecap="round" />
      <circle cx="216" cy="148" r="14" fill="#0f141a" />
      <path d="M216 156 v22" stroke="#0f141a" strokeWidth={8} strokeLinecap="round" />
      <text x="174" y="214" fontSize="12" fontFamily="Monaco, monospace" fill="#fff">TEE</text>
      <path d="M282 156 H318" stroke={P3} strokeWidth={3} strokeLinecap="round" />
      <path d="M310 148 l9 8 -9 8" fill="none" stroke={P3} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      <g transform="translate(326 104) rotate(5)">
        <rect width="80" height="102" rx="8" fill="#fff" stroke="#e9ebed" strokeWidth={2.5} />
        <path d="M14 24 h20 M44 24 h20 M14 42 h20 M44 42 h20" stroke="#5f6b7a" strokeWidth={3} strokeLinecap="round" />
        <circle cx="58" cy="76" r="13" fill="none" stroke={GREEN} strokeWidth={3} />
        <path d="m52 76 4 4 8 -9" fill="none" stroke={GREEN} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  )
}

/** Public record: a ledger card with a score. */
export function ArtRecord() {
  return (
    <svg className="doodle" viewBox="0 0 420 300" role="img" aria-label="A landlord record card showing deposits returned">
      <ellipse cx="210" cy="282" rx="160" ry="10" fill={P1} />
      <g transform="translate(70 30) rotate(-2)">
        <rect width="280" height="232" rx="18" fill="#fff" stroke={INK} strokeWidth={3} />
        <circle cx="46" cy="50" r="22" fill={P3} stroke={INK} strokeWidth={2.5} />
        <path d="M84 42 h96 M84 62 h60" stroke={INK} strokeWidth={3} strokeLinecap="round" />
        <text x="214" y="64" fontSize="34" fontWeight="800" fontFamily="system-ui, sans-serif" fill={P6}>94</text>
        <path d="M24 104 H256" stroke="#e3e6ea" strokeWidth={2} />
        {[0, 1, 2, 3].map((i) => (
          <g key={i} transform={`translate(24 ${122 + i * 24})`}>
            <rect width={[200, 170, 214, 120][i]} height="12" rx="6" fill={i === 3 ? '#e3e6ea' : P6} opacity={i === 3 ? 1 : 0.85 - i * 0.15} />
            <rect x={[200, 170, 214, 120][i]} width={232 - [200, 170, 214, 120][i]} height="12" rx="6" fill="#e3e6ea" />
          </g>
        ))}
      </g>
      <path d="M352 40 v16 M344 48 h16" {...S} stroke={P6} />
    </svg>
  )
}

/** Small round icons for the guarantees list. */
export function Ic({ d }: { d: string }) {
  return (
    <span className="ic">
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
        <path d={d} fill="none" stroke={P6} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}
