"use client";

interface BrandLogoProps {
  size?: number;
  className?: string;
  stroke?: string;
  accent?: string;
}

export default function BrandLogo({
  size = 64,
  className = "",
  stroke = "currentColor",
  accent = "#E8542A",
}: BrandLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      aria-label="GroundControl logo"
    >
      <g transform="rotate(118 32 32)">
        <circle
          cx="32"
          cy="32"
          r="21"
          stroke={stroke}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray="74 58"
        />
        <circle
          cx="32"
          cy="32"
          r="21"
          stroke={accent}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray="24 200"
          strokeDashoffset="-80"
        />
      </g>
    </svg>
  );
}
