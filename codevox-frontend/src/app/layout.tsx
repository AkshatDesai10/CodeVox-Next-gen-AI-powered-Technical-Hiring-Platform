import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { Providers } from '@/components/Providers';
import { AssessmentHeadAssets } from '@/modules/assessments/layout/AssessmentHeadAssets';
import '@/styles/codevox-theme.css';
import '@/app/globals.css';
import '@/modules/assessments/styles/assessment-theme.css';
import '@/modules/job-profiles/styles/codevox-recruiter.css';

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  variable: '--font-jakarta',
});

export const metadata: Metadata = {
  title: 'CodeVox — AI interviews & proctored coding assessments',
  description:
    'Next-gen AI-powered technical hiring with voice interviews, Monaco coding IDE, and live proctoring.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`codevox-theme-root ${jakarta.variable} dark`}
      suppressHydrationWarning
    >
      <body
        className={`${jakarta.className} min-h-screen bg-[var(--color-page)] font-sans text-[var(--color-text)] antialiased`}
      >
        <AssessmentHeadAssets />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
