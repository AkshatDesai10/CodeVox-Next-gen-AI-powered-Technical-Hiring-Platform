'use client';

import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { signIn, useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import '@/modules/marketing/styles/landing.css';

const DEMO_EMAIL = 'akshat@CodeVox';
const DEMO_PASSWORD = 'admin';

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
  const [loading, setLoading] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [email, setEmail] = useState(DEMO_EMAIL);
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const autoStarted = useRef(false);

  const rawCallback = searchParams.get('callbackUrl') || '/assessments';
  const callbackUrl =
    rawCallback === '/' || !rawCallback.startsWith('/')
      ? '/assessments'
      : rawCallback;
  const errorCode = searchParams.get('error');
  const errorMessage = errorCode
    ? (ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.Default)
    : null;

  async function loginWith(nextEmail: string, nextPassword: string) {
    setLoading(true);
    setFormError(null);
    const result = await signIn('credentials', {
      email: nextEmail,
      password: nextPassword,
      callbackUrl,
      redirect: false,
    });
    if (result?.error) {
      setLoading(false);
      setFormError(ERROR_MESSAGES.CredentialsSignin);
      return;
    }
    router.replace(result?.url || callbackUrl);
  }

  useEffect(() => {
    if (errorCode) {
      setLoading(false);
      return;
    }
    if (status === 'authenticated' && session?.access_token && !session.error) {
      router.replace(callbackUrl);
      return;
    }
    if (status !== 'unauthenticated') return;
    if (autoStarted.current) return;
    autoStarted.current = true;
    void loginWith(DEMO_EMAIL, DEMO_PASSWORD);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot demo auto-login
  }, [status, session, callbackUrl, router, errorCode]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await loginWith(email, password);
  }

  return (
    <div className="cvx-glass-panel w-full max-w-md p-8 sm:p-10">
      <Link href="/" className="text-xl font-bold tracking-tight text-white">
        Code<span className="cvx-text-gradient">Vox</span>
      </Link>
      <h1 className="mt-5 text-2xl font-bold tracking-tight text-white sm:text-3xl">
        Sign in to your workspace
      </h1>
      <p className="mt-2 text-sm text-[#A7B7CD]">
        Demo credentials are filled in — signing you in automatically.
      </p>

      {errorMessage || formError ? (
        <p className="mt-4 rounded-xl bg-[rgba(244,63,94,0.14)] px-3 py-2 text-sm text-[#fb7185]">
          {formError ?? errorMessage}
        </p>
      ) : null}

      <form className="mt-6 space-y-4" onSubmit={(e) => void onSubmit(e)}>
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-[#A7B7CD]">Email</span>
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
          <span className="mb-1.5 block font-medium text-[#A7B7CD]">Password</span>
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
      <Suspense fallback={<p className="text-sm text-[#A7B7CD]">Loading…</p>}>
        <SignInForm />
      </Suspense>
    </div>
  );
}
