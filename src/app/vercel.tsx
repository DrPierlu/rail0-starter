// Vercel's triangle mark, inlined as SVG (no external asset to fetch) and used
// under its "Powered by Vercel" / deploy-button convention: it marks where the
// template is meant to be deployed, and always links out to vercel.com. It is
// not a claim of affiliation or endorsement.

export function VercelLogo({ className = "h-3 w-3" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 76 65"
      fill="currentColor"
      role="img"
      aria-label="Vercel"
      className={className}
    >
      <title>Vercel</title>
      <path d="M37.5274 0L75.0548 65H0L37.5274 0Z" />
    </svg>
  );
}

/** Wordmark-style link: the triangle followed by the label. */
export function VercelLink({
  label = "Deploy on Vercel",
  className = "",
}: {
  label?: string;
  className?: string;
}) {
  return (
    <a
      href="https://vercel.com/new"
      target="_blank"
      rel="noreferrer"
      className={`inline-flex items-center gap-1.5 hover:underline ${className}`}
    >
      <VercelLogo />
      {label}
    </a>
  );
}
