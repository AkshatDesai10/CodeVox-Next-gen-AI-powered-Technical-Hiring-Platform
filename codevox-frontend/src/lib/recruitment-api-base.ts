export function recruitmentApiBase(): string {
  return (
    process.env.NEXT_PUBLIC_RECRUITMENT_API_URL ?? 'http://localhost:4000'
  ).replace(/\/$/, '');
}
