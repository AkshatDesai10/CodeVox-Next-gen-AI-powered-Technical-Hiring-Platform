'use client';

import { Suspense, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { signIn, useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import '@/modules/marketing/styles/landing.css';

const ERROR_MESSAGES: Record<string, string> = {
  Configuration: 'Sign-in is not configured correctly. Contact your administrator.',
  AccessDenied: 'You do not have permission to access this portal.',
  CredentialsSignin: 'Invalid email or password.',
  Callback: 'Something went wrong during sign-in.',
  SessionRequired: 'Please sign in to continue.',
  Default: 'Unable to sign in. Please try again.',
};

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { status, data: session } = useSession();
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [email, setEmail] = useState('admin@localhost');
  const [password, setPassword] = useState('');

  const rawCallback = searchParams.get('callbackUrl') || '/assessments';
  const callbackUrl =
    rawCallback === '/' || !rawCallback.startsWith('/')
      ? '/assessments'
      : rawCallback;
  const errorCode = searchParams.get('error');
  const errorMessage = errorCode
    ? (ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.Default)
    : null;

  useEffect(() => {
    if (errorCode) return;
    if (status === 'authenticated' && session?.access_token && !session.error) {
      router.replace(callbackUrl);
    }
  }, [status, session, callbackUrl, router, errorCode]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setFormError(null);
    const result = await signIn('credentials', {
      email,
      password,
      callbackUrl,
      redirect: false,
    });
    setLoading(false);
    if (result?.error) {
      setFormError(ERROR_MESSAGES.CredentialsSignin);
      return;
    }
    router.replace(result?.url || callbackUrl);
  }

  return (
    <div className="cvx-glass-panel w-full max-w-md p-8 sm:p-10">
      <Link href="/" className="text-xl font-bold tracking-tight text-white">
        Code<span className="cvx-text-gradient">Vox</span>
      </Link>
      <h1 className="mt-5 text-2xl font-bold tracking-tight text-white sm:text-3xl">
        Sign in to your workspace
      </h1>
      <p className="mt-2 text-sm text-[#C4B5FD]">
        Use your local admin credentials to continue.
      </p>

      {errorMessage || formError ? (
        <p className="mt-4 rounded-xl bg-[rgba(244,63,94,0.14)] px-3 py-2 text-sm text-[#fb7185]">
          {formError ?? errorMessage}
        </p>
      ) : null}

      <form className="mt-6 space-y-4" onSubmit={(e) => void onSubmit(e)}>
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-[#C4B5FD]">Email</span>
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="codevox-input"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-[#C4B5FD]">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="codevox-input"
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="cvx-btn-primary mt-2 w-full justify-center py-3.5 text-sm disabled:opacity-60"
        >
          {loading ? 'Signing in…' : 'Sign in to Console →'}
        </button>
      </form>
    </div>
  );
}

export default function SignInPage() {
  return (
    <div className="cvx-landing flex min-h-screen items-center justify-center px-4">
      <div className="cvx-hero-glow absolute inset-0" />
      <Suspense fallback={<p className="text-sm text-[#C4B5FD]">Loading…</p>}>
        <SignInForm />
      </Suspense>
    </div>
  );
}
