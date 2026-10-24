import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface Session {
    access_token?: string;
    id_token?: string;
    error?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    expires_at?: number;
    user?: { name: string | null; email: string | null };
    error?: string;
  }
}
