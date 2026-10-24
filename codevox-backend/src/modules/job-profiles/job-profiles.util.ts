import { randomBytes } from 'crypto';

export function slugifyTitle(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const suffix = randomBytes(3).toString('hex');
  return `${base || 'role'}-${suffix}`;
}

export function generateInterviewToken(): string {
  return `jp-${randomBytes(16).toString('hex')}`;
}

export function deriveSkillsFromJobProfile(row: {
  title: string;
  slug?: string;
  requiredSkills?: string[] | null;
  niceToHaveSkills?: string[] | null;
  responsibilities?: string[] | null;
}): string[] {
  const fromDb = [
    ...(row.requiredSkills ?? []),
    ...(row.niceToHaveSkills ?? []),
    ...(row.responsibilities ?? []),
  ]
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromDb.length) return [...new Set(fromDb)].slice(0, 10);

  const blob = `${row.title} ${row.slug ?? ''}`.toLowerCase();
  const inferred: string[] = [];
  if (/developer|engineer|devops|analyst/.test(blob)) inferred.push('Software engineering');
  if (/junior|entry|fresher|trainee/.test(blob)) inferred.push('Junior-level fundamentals');
  if (/senior|lead|principal|staff/.test(blob)) inferred.push('Advanced system design');
  if (/\bhp\b|hewlett/.test(blob)) inferred.push('HP platforms and tooling');
  if (/frontend|react|angular|vue|ui\b/.test(blob)) inferred.push('Frontend development');
  if (/backend|api|microservice/.test(blob)) inferred.push('Backend APIs');
  if (/database|sql|dbms/.test(blob)) inferred.push('Databases');
  if (/cctv|video|analytics|ai\b/.test(blob)) inferred.push('Video analytics');

  const titleTokens = row.title
    .split(/[\s\-/&,]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 2);

  const merged = [...new Set([...titleTokens, ...inferred, row.title.trim()])].filter(Boolean);
  return merged.slice(0, 8);
}

export function inferSeniorityFromJobProfile(row: {
  seniorityLevel?: string | null;
  title?: string;
  slug?: string;
}): string {
  if (row.seniorityLevel?.trim()) return row.seniorityLevel.trim();
  const blob = `${row.title ?? ''} ${row.slug ?? ''}`.toLowerCase();
  if (/junior|entry|fresher|trainee|intern/.test(blob)) return 'junior';
  if (/senior|lead|principal|staff|architect/.test(blob)) return 'senior';
  return 'mid';
}

export function seniorityToDifficulty(seniority?: string | null): 'EASY' | 'MEDIUM' | 'HARD' {
  const s = (seniority ?? '').toLowerCase();
  if (s.includes('junior') || s.includes('entry')) return 'EASY';
  if (s.includes('senior') || s.includes('lead') || s.includes('principal')) return 'HARD';
  return 'MEDIUM';
}
