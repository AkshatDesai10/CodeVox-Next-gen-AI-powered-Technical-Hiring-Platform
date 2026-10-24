export const SUPPORTED_PROBLEM_LANGUAGES = ['javascript', 'python', 'java', 'php', 'cpp'] as const;

export type SupportedProblemLanguage = (typeof SUPPORTED_PROBLEM_LANGUAGES)[number];

export function inferTechStackFromText(blob: string, fallback = 'General programming'): string {
  const text = blob.toLowerCase();
  if (!text.trim()) return fallback;
  const stacks: string[] = [];
  if (/php|laravel|symfony|wordpress/.test(text)) stacks.push('PHP');
  if (/python|django|fastapi|flask|pandas/.test(text)) stacks.push('Python');
  if (/javascript|typescript|node\.?js|react|angular|vue|next\.?js|frontend/.test(text)) {
    stacks.push('JavaScript / TypeScript');
  }
  if (/java|kotlin|spring|android/.test(text)) stacks.push('Java');
  if (/c\+\+|cpp/.test(text)) stacks.push('C++');
  if (/c#|\.net|dotnet|asp\.net/.test(text)) stacks.push('C# / .NET');
  if (/go\b|golang/.test(text)) stacks.push('Go');
  if (/rust/.test(text)) stacks.push('Rust');
  if (/ruby|rails/.test(text)) stacks.push('Ruby');
  if (/sql|mysql|postgres|postgresql|database|mongodb|redis/.test(text)) stacks.push('SQL / Databases');
  if (/devops|aws|azure|gcp|cloud|kubernetes|docker/.test(text)) stacks.push('Cloud / DevOps');
  if (stacks.length) return [...new Set(stacks)].slice(0, 4).join(', ');
  return fallback;
}

export function inferLanguagesFromTechStack(
  techStack: string,
  allowed: readonly string[] = SUPPORTED_PROBLEM_LANGUAGES,
): string[] {
  const blob = techStack.toLowerCase();
  const langs: string[] = [];
  if (/javascript|typescript|node|react|angular|vue|frontend|next\.?js/.test(blob)) langs.push('javascript');
  if (/python|django|fastapi|flask/.test(blob)) langs.push('python');
  if (/java|kotlin|spring|android/.test(blob)) langs.push('java');
  if (/php|laravel|symfony|wordpress/.test(blob)) langs.push('php');
  if (/c\+\+|cpp/.test(blob)) langs.push('cpp');
  const filtered = langs.filter((lang) => allowed.includes(lang));
  if (filtered.length) return [...new Set(filtered)].slice(0, 3);
  return ['javascript'];
}
