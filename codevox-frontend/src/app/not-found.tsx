import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-screen  flex-col items-center justify-center bg-[var(--assessment-surface-container-low)]">
      <div className="text-center">
        <h1 className="text-9xl font-bold text-[var(--assessment-primary)]">404</h1>
        <h2 className="mt-4 text-3xl font-semibold text-[var(--assessment-on-surface)]">
          Page Not Found
        </h2>
        <p className="mt-4 text-lg text-[var(--assessment-on-surface-variant)]">
          The page you are looking for doesn't exist, has been moved, or is temporarily unavailable.
        </p>
        <div className="mt-8">
          <Link 
            href="/"
            className="rounded-full bg-[var(--assessment-primary)] px-8 py-3 text-sm font-semibold text-black shadow-sm transition-colors hover:bg-[var(--assessment-primary-container)]"
          >
            Return to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
