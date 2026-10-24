/** API base for viva-assessment-backend (default port 3300). */
export function vivaApiBase(): string {
  return (
    process.env.NEXT_PUBLIC_VIVA_API_URL?.trim() || 'http://localhost:3300'
  ).replace(/\/$/, '');
}
