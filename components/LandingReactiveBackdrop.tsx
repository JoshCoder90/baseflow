/**
 * Giant soft blobs — motion runs on outer wrappers; blur lives on inner surfaces
 * so transforms composite reliably (heavy filter + transform can look “stuck”).
 */
export function LandingReactiveBackdrop() {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-[1] overflow-hidden"
      aria-hidden
    >
      <div className="bf-landing-base absolute inset-0" />

      <div className="bf-landing-atmosphere">
        <div className="bf-landing-glow bf-landing-glow--nw">
          <div className="bf-landing-glow-inner" />
        </div>
        <div className="bf-landing-glow bf-landing-glow--se">
          <div className="bf-landing-glow-inner" />
        </div>
        <div className="bf-landing-glow bf-landing-glow--mid">
          <div className="bf-landing-glow-inner" />
        </div>
      </div>

      <div className="bf-landing-fluid">
        <div className="bf-landing-blob bf-landing-blob--1">
          <div className="bf-landing-blob-inner" />
        </div>
        <div className="bf-landing-blob bf-landing-blob--2">
          <div className="bf-landing-blob-inner" />
        </div>
        <div className="bf-landing-blob bf-landing-blob--3">
          <div className="bf-landing-blob-inner" />
        </div>
        <div className="bf-landing-blob bf-landing-blob--4">
          <div className="bf-landing-blob-inner" />
        </div>
      </div>

      <div className="bf-landing-noise" />
      <div className="bf-ambient__vignette bf-landing-vignette--light" />
    </div>
  )
}
