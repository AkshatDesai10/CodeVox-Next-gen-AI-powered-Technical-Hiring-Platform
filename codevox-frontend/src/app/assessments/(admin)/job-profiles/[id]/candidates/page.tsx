import { redirect } from 'next/navigation';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ course?: string }>;
}) {
  const params = await searchParams;
  const course = params.course?.trim();
  const q = course ? `?course=${encodeURIComponent(course)}` : '';
  redirect(`/assessments/recruitment/leads${q}`);
}
