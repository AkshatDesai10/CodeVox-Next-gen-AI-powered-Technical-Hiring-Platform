import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/signin',
    error: '/signin',
  },
  providers: [
    CredentialsProvider({
      id: 'credentials',
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const expectedEmail = (
          process.env.LOCAL_AUTH_EMAIL || 'akshat@CodeVox'
        )
          .trim()
          .toLowerCase();
        const expectedPassword = process.env.LOCAL_AUTH_PASSWORD || 'admin';
        const email = (credentials?.email ?? '').trim().toLowerCase();
        const password = credentials?.password ?? '';

        if (!email || !password) return null;
        if (email !== expectedEmail || password !== expectedPassword) {
          return null;
        }

        return {
          id: 'local-admin',
          email: expectedEmail,
          name: process.env.LOCAL_AUTH_NAME || 'Akshat',
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.access_token =
          process.env.LOCAL_AUTH_TOKEN || 'local-dev-token';
        token.user = {
          name: user.name ?? null,
          email: user.email ?? null,
        };
        token.error = undefined;
      }
      return token;
    },
    async session({ session, token }) {
      session.access_token = token.access_token;
      session.user = token.user ?? session.user;
      session.error = token.error;
      return session;
    },
    async redirect({ url, baseUrl }) {
      if (url.startsWith('/')) return `${baseUrl}${url}`;
      try {
        if (new URL(url).origin === baseUrl) return url;
      } catch {
        /* ignore */
      }
      return baseUrl;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
