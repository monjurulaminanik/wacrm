"use client";

/**
 * Soft luxury atmosphere — slow drifting orbs behind glass panels.
 * Respects prefers-reduced-motion.
 */
export function AmbientBackdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_10%_-10%,color-mix(in_oklch,var(--primary)_28%,transparent),transparent_55%),radial-gradient(90%_70%_at_90%_10%,oklch(0.45_0.08_250_/_0.35),transparent_50%),linear-gradient(165deg,oklch(0.14_0.02_250),oklch(0.09_0.015_260)_45%,oklch(0.11_0.02_40))]" />
      <div className="atmosphere-orb atmosphere-orb-a" />
      <div className="atmosphere-orb atmosphere-orb-b" />
      <div className="atmosphere-orb atmosphere-orb-c" />
      <div className="absolute inset-0 opacity-[0.04] [background-image:linear-gradient(rgba(255,255,255,.5)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.5)_1px,transparent_1px)] [background-size:48px_48px]" />
      <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-transparent to-background/40" />
    </div>
  );
}
