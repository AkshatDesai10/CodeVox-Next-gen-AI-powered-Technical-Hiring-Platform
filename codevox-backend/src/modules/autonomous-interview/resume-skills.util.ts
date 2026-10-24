/** Tech-stack keyed resume skill pools for autonomous interview rotation. */

const STACK_RESUME_SKILLS: Record<string, string[]> = {
  php: ['PHP', 'Laravel', 'MySQL', 'REST APIs', 'Redis', 'System Design'],
  python: ['Python', 'Django', 'Flask', 'SQL', 'REST APIs', 'System Design'],
  javascript: ['JavaScript', 'Node.js', 'React', 'REST APIs', 'SQL', 'System Design'],
  java: ['Java', 'Spring Boot', 'SQL', 'System Design', 'REST APIs'],
  react: ['React', 'JavaScript', 'TypeScript', 'REST APIs', 'System Design'],
  sql: ['SQL', 'MySQL', 'PostgreSQL', 'Database Design', 'Query Optimization'],
  aiml: ['Python', 'Machine Learning', 'PyTorch', 'TensorFlow', 'Data Analysis', 'SQL'],
};

const ENTRY_STACK_RESUME_SKILLS: Record<string, string[]> = {
  php: ['PHP', 'HTML/CSS', 'MySQL', 'Basic SQL', 'Git', 'REST APIs'],
  python: ['Python', 'Git', 'SQL', 'REST APIs', 'HTML/CSS'],
  javascript: ['JavaScript', 'HTML/CSS', 'Git', 'REST APIs', 'SQL'],
  java: ['Java', 'Git', 'SQL', 'REST APIs'],
  react: ['React', 'JavaScript', 'HTML/CSS', 'Git', 'REST APIs'],
  sql: ['SQL', 'MySQL', 'Basic SQL', 'Database Design'],
  aiml: ['Python', 'Machine Learning', 'Basic SQL', 'Data Analysis', 'Git'],
};

const SKILL_ALIASES: Record<string, string> = {
  node: 'javascript',
  'node.js': 'javascript',
  nodejs: 'javascript',
  laravel: 'php',
  django: 'python',
  flask: 'python',
  postgres: 'sql',
  postgresql: 'sql',
  mysql: 'sql',
  ai: 'aiml',
  ml: 'aiml',
  'machine learning': 'aiml',
  'data science': 'aiml',
  'artificial intelligence': 'aiml',
};

/** Job tech_stack labels that are too broad to exclusively filter a resume. */
const GENERIC_STACK_KEYS = new Set([
  'ai',
  'ml',
  'aiml',
  'general',
  'other',
  'na',
  'n/a',
  'none',
  'any',
  'software',
  'it',
]);

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

export function dedupeSkills(skills?: string[] | null): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of skills ?? []) {
    const label = String(raw ?? '').trim();
    if (!label) continue;
    const key = normalizeKey(label);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

export function resolveStackKey(techStack: string): string {
  const key = normalizeKey(techStack);
  const aliased = SKILL_ALIASES[key];
  if (aliased && STACK_RESUME_SKILLS[aliased]) {
    return aliased;
  }
  for (const stack of Object.keys(STACK_RESUME_SKILLS)) {
    if (key === stack || key.includes(stack)) {
      return stack;
    }
  }
  return aliased ?? key;
}

function canonicalSkillKey(skill: string): string {
  const normalized = normalizeKey(skill);
  return SKILL_ALIASES[normalized] ?? normalized;
}

function poolForStack(stackKey: string, entryLevel: boolean): string[] {
  if (entryLevel) {
    return ENTRY_STACK_RESUME_SKILLS[stackKey] ?? STACK_RESUME_SKILLS[stackKey] ?? [];
  }
  return STACK_RESUME_SKILLS[stackKey] ?? [];
}

function isGenericTechStack(techStack: string, stackKey: string): boolean {
  const raw = normalizeKey(techStack);
  if (!raw || raw.length <= 2) return true;
  if (GENERIC_STACK_KEYS.has(raw) || GENERIC_STACK_KEYS.has(stackKey)) return true;
  if (!STACK_RESUME_SKILLS[stackKey]) return true;
  return false;
}

function skillMatchesTech(
  skill: string,
  stackKey: string,
  entryLevel = false,
): boolean {
  const skillKey = canonicalSkillKey(skill);
  if (skillKey.includes(stackKey) || stackKey.includes(skillKey)) {
    return true;
  }
  const pool = poolForStack(stackKey, entryLevel);
  return pool.some((entry) => canonicalSkillKey(entry) === skillKey);
}

/**
 * Build ordered resume skills for the interview.
 * Candidate skills are the source of truth. tech_stack is used to rank matches
 * first, never to throw away a real resume skill when the stack label is vague.
 */
export function buildResumeSkillsForTech(
  techStack: string,
  candidateSkills?: string[] | null,
  maxSkills = 8,
  entryLevel = false,
): string[] {
  const uniqueCandidate = dedupeSkills(candidateSkills);
  const primary = techStack.trim();
  if (!primary) {
    return uniqueCandidate.slice(0, maxSkills);
  }
  const stackKey = resolveStackKey(primary);

  if (uniqueCandidate.length > 0) {
    const generic = isGenericTechStack(primary, stackKey);
    const matched = uniqueCandidate.filter((skill) =>
      skillMatchesTech(skill, stackKey, entryLevel),
    );
    const rest = uniqueCandidate.filter(
      (skill) => !skillMatchesTech(skill, stackKey, entryLevel),
    );
    // Exclusive filter would collapse vague stacks like "Ai" to [techStack].
    // Inclusive: keep every real skill; only reorder when the stack is specific
    // and actually matches more than one resume item.
    const ordered =
      generic || matched.length <= 1 ? uniqueCandidate : [...matched, ...rest];
    return ordered;
  }

  const defaults =
    poolForStack(stackKey, entryLevel).length > 0
      ? poolForStack(stackKey, entryLevel)
      : entryLevel
        ? [primary, 'Git', 'REST APIs']
        : [primary, 'SQL', 'REST APIs', 'System Design'];

  const merged: string[] = [];
  const seen = new Set<string>();
  for (const skill of [primary, ...defaults]) {
    const label = skill.trim();
    if (!label) continue;
    const key = normalizeKey(label);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(label);
    if (merged.length >= maxSkills) break;
  }
  return merged;
}
