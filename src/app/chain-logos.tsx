/**
 * The chains' own marks.
 *
 * Real logos rather than letters, so a row is recognised at the speed the eye reads a
 * colour. Inlined as SVG and not fetched: five network requests to five CDNs, on a page
 * that polls, to draw sixteen pixels each — and a logo that fails to load leaves a hole
 * exactly where the demo is meant to look finished.
 *
 * Provenance, so this can be re-derived rather than trusted:
 *
 *   Arc          web3icons raw-svgs/networks/branded/arc.svg — their own metadata gives
 *                this network chainId 5042002, which is the Arc Testnet id in the
 *                gateway's seeds, so the mark belongs to THIS chain and not to another
 *                project of the same name.
 *   Base         base/brand-kit, logo/TheSquare/Digital/Base_square_blue.svg (official).
 *                The `fill: blue` its stylesheet sets is written out as #0000FF here,
 *                because a class-based fill inside an inlined SVG would collide with the
 *                next one.
 *   Optimism     OpenWRLD/brand-kit, assets/svg/Profile-Logo.svg (Optimism's own kit).
 *   Arbitrum     web3icons raw-svgs/networks/branded/arbitrum-one.svg.
 *   Polygon      web3icons raw-svgs/networks/branded/polygon.svg.
 *
 * Nominative use: these identify the chain a payment settled on, which is the same job a
 * card network's mark does at a checkout. They are the brands' property, not this
 * template's — a fork that rebrands should replace them, and one that ships them keeps
 * them accurate rather than redrawn.
 *
 * Gradient ids are prefixed per logo. Two of these carry a `paint0_linear_…` id from the
 * same tool, and in one document the second definition wins — silently painting one
 * chain in another's colours.
 */

interface LogoProps {
  className?: string;
}

function ArcLogo({ className }: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M3.5 20.9988C3.64596 16.5923 4.39308 12.48 5.64212 9.28212C7.22346 5.23096 9.51327 3 12.0881 3C14.6629 3 16.9527 5.23096 18.5346 9.28269C19.3573 11.3896 19.9625 13.8935 20.3213 16.6171C20.3537 16.8606 20.3808 17.1075 20.4085 17.3544C20.4177 17.3694 20.4229 17.3838 20.4212 17.3954C20.4212 17.3954 20.6317 18.7119 20.6767 20.9994H20.6531C20.3404 20.7427 16.6533 17.846 10.5413 18.6848C10.6337 17.6504 10.7606 16.6442 10.9244 15.6796C10.9331 15.6306 10.9423 15.5827 10.951 15.5337C13.3481 15.4615 15.4463 15.7396 17.0554 16.1048C17.0496 16.0667 17.0444 16.0275 17.0381 15.9894C16.7075 13.9298 16.2194 12.0444 15.59 10.4331C14.5613 7.79827 13.2188 6.16154 12.0875 6.16154C10.9562 6.16154 9.61365 7.79827 8.585 10.4331C8.33577 11.0706 8.10904 11.7502 7.90596 12.4667C7.62038 13.4712 7.38038 14.5483 7.18827 15.6796C6.90442 17.351 6.72731 19.1429 6.66212 21H3.5V20.9988Z"
        fill="url(#arc-paint0_linear_559_322)"
      />
      <defs>
        <linearGradient
          id="arc-paint0_linear_559_322"
          x1="12.0884"
          y1="3"
          x2="12.0884"
          y2="21"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#182680" />
          <stop offset="1" stopColor="#842D56" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function BaseLogo({ className }: LogoProps) {
  return (
    <svg viewBox="0 0 1280 1280" className={className} aria-hidden="true">
      <path
        fill="#0000FF"
        d="M0,101.12c0-34.64,0-51.95,6.53-65.28,6.25-12.76,16.56-23.07,29.32-29.32C49.17,0,66.48,0,101.12,0h1077.76c34.63,0,51.96,0,65.28,6.53,12.75,6.25,23.06,16.56,29.32,29.32,6.52,13.32,6.52,30.64,6.52,65.28v1077.76c0,34.63,0,51.96-6.52,65.28-6.26,12.75-16.57,23.06-29.32,29.32-13.32,6.52-30.65,6.52-65.28,6.52H101.12c-34.64,0-51.95,0-65.28-6.52-12.76-6.26-23.07-16.57-29.32-29.32-6.53-13.32-6.53-30.65-6.53-65.28V101.12Z"
      />
    </svg>
  );
}

function OptimismLogo({ className }: LogoProps) {
  return (
    <svg viewBox="0 0 500 500" className={className} aria-hidden="true">
      <circle cx="250" cy="250" r="250" fill="#FF0420" />
      <path
        d="M177.133 316.446C162.247 316.446 150.051 312.943 140.544 305.938C131.162 298.808 126.471 288.676 126.471 275.541C126.471 272.789 126.784 269.411 127.409 265.408C129.036 256.402 131.35 245.581 134.352 232.947C142.858 198.547 164.812 181.347 200.213 181.347C209.845 181.347 218.476 182.973 226.107 186.225C233.738 189.352 239.742 194.106 244.12 200.486C248.498 206.74 250.688 214.246 250.688 223.002C250.688 225.629 250.375 228.944 249.749 232.947C247.873 244.08 245.621 254.901 242.994 265.408C238.616 282.546 231.048 295.368 220.29 303.874C209.532 312.255 195.147 316.446 177.133 316.446ZM179.76 289.426C186.766 289.426 192.707 287.362 197.586 283.234C202.59 279.106 206.155 272.789 208.281 264.283C211.158 252.524 213.348 242.266 214.849 233.51C215.349 230.883 215.599 228.194 215.599 225.441C215.599 214.058 209.657 208.366 197.774 208.366C190.768 208.366 184.764 210.43 179.76 214.558C174.882 218.687 171.379 225.004 169.253 233.51C167.001 241.891 164.749 252.149 162.498 264.283C161.997 266.784 161.747 269.411 161.747 272.163C161.747 283.672 167.752 289.426 179.76 289.426Z"
        fill="white"
      />
      <path
        d="M259.303 314.57C257.927 314.57 256.863 314.132 256.113 313.256C255.487 312.255 255.3 311.13 255.55 309.879L281.444 187.914C281.694 186.538 282.382 185.412 283.508 184.536C284.634 183.661 285.822 183.223 287.073 183.223H336.985C350.87 183.223 362.003 186.1 370.384 191.854C378.891 197.609 383.144 205.927 383.144 216.81C383.144 219.937 382.769 223.19 382.018 226.567C378.891 240.953 372.574 251.586 363.067 258.466C353.685 265.346 340.8 268.786 324.413 268.786H299.082L290.451 309.879C290.2 311.255 289.512 312.38 288.387 313.256C287.261 314.132 286.072 314.57 284.822 314.57H259.303ZM325.727 242.892C330.98 242.892 335.546 241.453 339.424 238.576C343.427 235.699 346.054 231.571 347.305 226.192C347.68 224.065 347.868 222.189 347.868 220.563C347.868 216.935 346.805 214.183 344.678 212.307C342.551 210.305 338.924 209.305 333.795 209.305H311.278L304.148 242.892H325.727Z"
        fill="white"
      />
    </svg>
  );
}

function ArbitrumLogo({ className }: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M4.51514 8.47125V15.5274C4.51514 15.9779 4.75959 16.3944 5.15552 16.6189L11.3599 20.1477C11.7558 20.3722 12.2432 20.3722 12.6392 20.1477L18.8435 16.6189C19.2394 16.3944 19.4839 15.9779 19.4839 15.5274V8.47125C19.4839 8.02072 19.2394 7.60418 18.8435 7.37966L12.6392 3.85086C12.2432 3.62634 11.7558 3.62634 11.3599 3.85086L5.15401 7.37966C4.75809 7.60418 4.51514 8.02072 4.51514 8.47125Z"
        fill="#213147"
      />
      <path
        d="M13.3531 13.3677L12.4682 15.7577C12.4442 15.8241 12.4442 15.8965 12.4682 15.963L13.9905 20.0752L15.7511 19.0738L13.638 13.3677C13.59 13.2363 13.401 13.2363 13.3531 13.3677Z"
        fill="#12AAFF"
      />
      <path
        d="M15.1273 9.3485C15.0793 9.21704 14.8903 9.21704 14.8423 9.3485L13.9575 11.7384C13.9334 11.8049 13.9334 11.8773 13.9575 11.9437L16.4515 18.6764L18.2122 17.6749L15.1273 9.3485Z"
        fill="#12AAFF"
      />
      <path
        d="M11.9984 4.11521C12.0419 4.11521 12.0854 4.12703 12.1244 4.14771L18.8387 7.96602C18.9166 8.01033 18.9647 8.09305 18.9647 8.1802V15.8153C18.9647 15.904 18.9166 15.9852 18.8387 16.0295L12.1244 19.8479C12.0869 19.87 12.0419 19.8803 11.9984 19.8803C11.955 19.8803 11.9114 19.8685 11.8725 19.8479L5.15817 16.0325C5.08019 15.9881 5.0322 15.9055 5.0322 15.8183V8.18167C5.0322 8.09305 5.08019 8.01181 5.15817 7.9675L11.8725 4.14919C11.9114 4.12703 11.955 4.11521 11.9984 4.11521ZM11.9984 3C11.76 3 11.52 3.06056 11.3056 3.18316L4.59277 6.99999C4.16386 7.24371 3.8999 7.69423 3.8999 8.18167V15.8168C3.8999 16.3043 4.16386 16.7548 4.59277 16.9985L11.3071 20.8168C11.5215 20.938 11.76 21 11.9999 21C12.2384 21 12.4783 20.9395 12.6928 20.8168L19.407 16.9985C19.836 16.7548 20.0999 16.3043 20.0999 15.8168V8.18167C20.0999 7.69423 19.836 7.24371 19.407 6.99999L12.6913 3.18316C12.4768 3.06056 12.2369 3 11.9984 3Z"
        fill="#9DCCED"
      />
      <path
        d="M7.55859 18.6854L8.17649 17.0192L9.41975 18.0369L8.25747 19.0827L7.55859 18.6854Z"
        fill="#213147"
      />
      <path
        d="M11.4334 7.63513H9.73114C9.60366 7.63513 9.48969 7.71342 9.44619 7.83158L5.79736 17.6838L7.55804 18.6854L11.5758 7.83602C11.6133 7.73853 11.5398 7.63513 11.4334 7.63513Z"
        fill="white"
      />
      <path
        d="M14.4117 7.63513H12.7095C12.582 7.63513 12.468 7.71342 12.4245 7.83158L8.2583 19.0812L10.019 20.0827L14.5542 7.83602C14.5902 7.73853 14.5166 7.63513 14.4117 7.63513Z"
        fill="white"
      />
    </svg>
  );
}

function PolygonLogo({ className }: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M16.3644 15.217L20.6338 12.7816C20.8601 12.6521 21 12.4122 21 12.1547V7.2838C21 7.02631 20.8601 6.7864 20.6338 6.65702L16.3644 4.22156C16.138 4.09218 15.8569 4.09344 15.6319 4.22156L11.3623 6.65702C11.136 6.7864 10.9961 7.02631 10.9961 7.2838V15.9882L8.00191 17.6951L5.00763 15.9882V12.5729L8.00191 10.866L9.97646 11.9927V9.70168L8.36809 8.78352C8.25748 8.72071 8.13032 8.68679 8.00191 8.68679C7.87349 8.68679 7.74634 8.72071 7.63573 8.78352L3.36617 11.2191C3.13986 11.3484 3 11.5882 3 11.8457V16.7167C3 16.9742 3.13986 17.2141 3.36617 17.3434L7.63573 19.779C7.86205 19.907 8.14177 19.907 8.36809 19.779L12.6376 17.3434C12.864 17.2141 13.0039 16.9742 13.0039 16.7167V8.01231L13.0571 7.98216L15.9968 6.30534L18.9911 8.01231V11.4275L15.9968 13.1344L14.0247 12.0103V14.3013L15.6306 15.217C15.857 15.345 16.1379 15.345 16.3629 15.217H16.3644Z"
        fill="url(#pol-paint0_linear_328_59720)"
      />
      <defs>
        <linearGradient
          id="pol-paint0_linear_328_59720"
          x1="2.94151"
          y1="17.194"
          x2="20.1188"
          y2="7.10065"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#A726C1" />
          <stop offset="0.88" stopColor="#803BDF" />
          <stop offset="1" stopColor="#7B3FE4" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/**
 * Which mark belongs to which chain id.
 *
 * Testnet and mainnet ids both, pointing at the same mark: the brand does not change
 * between them, and the chip's LABEL is what says "Sepolia". Keyed by id and not by name
 * because the name is a gateway seeds value, editable there without this file noticing.
 */
const CHAIN_LOGOS: Record<number, (props: LogoProps) => React.ReactElement> = {
  5042002: ArcLogo, // Arc Testnet
  84532: BaseLogo, // Base Sepolia
  8453: BaseLogo, // Base
  11155420: OptimismLogo, // Optimism Sepolia
  10: OptimismLogo, // OP Mainnet
  421614: ArbitrumLogo, // Arbitrum Sepolia
  42161: ArbitrumLogo, // Arbitrum One
  80002: PolygonLogo, // Polygon Amoy
  137: PolygonLogo, // Polygon
};

/**
 * The chain's mark, or nothing when this app has no logo for it.
 *
 * Nothing rather than a placeholder: the caller falls back to the lettered dot, which is
 * what a chain added to the gateway's seeds after this release gets. A new chain must not
 * need a release here to render.
 */
export function ChainLogo({ chainId, className }: { chainId?: number; className?: string }) {
  const Logo = chainId === undefined ? undefined : CHAIN_LOGOS[chainId];
  return Logo ? <Logo className={className} /> : null;
}

/** Whether a chain has a real mark — lets a caller pick its container before rendering. */
export function hasChainLogo(chainId?: number): boolean {
  return chainId !== undefined && chainId in CHAIN_LOGOS;
}
