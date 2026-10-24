'use client';

/**
 * Drawer dimming + dismiss target that does not cover the workspace sidebar (206px).
 * The visual overlay is pointer-events-none so sidebar/topbar links stay clickable.
 */
export function DrawerBackdrop(props: {
  onClose: () => void;
  /** Extra classes for the dim layer (e.g. backdrop-blur). */
  dimClassName?: string;
}) {
  return (
    <>
      <div
        className={`pointer-events-none fixed inset-0 z-40 ${props.dimClassName ?? 'bg-black/30'}`}
        aria-hidden
      />
      <button
        type="button"
        className="fixed bottom-0 right-0 top-11 z-40 border-0 bg-transparent p-0 left-[206px]"
        aria-label="Close"
        onClick={props.onClose}
      />
    </>
  );
}
