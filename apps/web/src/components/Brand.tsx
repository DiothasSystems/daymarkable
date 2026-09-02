/** Brand primitives from the style guide: compass rose, wordmark, emblem. */

/** The compass rose stands in for the emblem below 48px and on dark backgrounds. */
export function CompassRose({ size = 28, color = "#c9973f", stroke = 5, className }: { size?: number; color?: string; stroke?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 72 72" aria-hidden className={className}>
      <circle cx="36" cy="36" r="26" fill="none" stroke={color} strokeWidth={stroke} />
      <path d="M 36 2 L 41 12 L 36 18 L 31 12 Z" fill={color} />
      <path d="M 36 70 L 41 60 L 36 54 L 31 60 Z" fill={color} />
      <path d="M 2 36 L 12 31 L 18 36 L 12 41 Z" fill={color} />
      <path d="M 70 36 L 60 31 L 54 36 L 60 41 Z" fill={color} />
    </svg>
  );
}

/** "day" in gold, "Markable" in Midnight (Parchment on dark). Never another typeface. */
export function Wordmark({ size = 20 }: { size?: number }) {
  return (
    <span className="wordmark" style={{ fontSize: size }}>
      <span className="day">day</span>Markable
    </span>
  );
}

export function Emblem({ size = 96, className }: { size?: number; className?: string }) {
  const src = size <= 96 ? "/brand/emblem-96.png" : size <= 256 ? "/brand/emblem-256.png" : "/brand/emblem-512.png";
  return <img src={src} width={size} height={size} alt="dayMarkable emblem" className={className} style={{ width: size, height: size }} />;
}
