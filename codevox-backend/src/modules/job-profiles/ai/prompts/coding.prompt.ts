export const CODING_GENERATION_RULES = `The generated problem must:
- Match the job profile, technology stack, competency, and expected skill level.
- Use starter code and solutions in the supported languages listed in the configuration (prefer the primary stack language).
- Focus on algorithmic thinking and practical coding relevant to the role's stack.
- Be realistic and inspired by real engineering scenarios.
- Not require external APIs, internet access, operating system features, or third-party libraries.
- Not require external database servers — but when requires_sandbox_database is true, include DDL and seed SQL for the platform's pre-loaded sandbox database.
- Be completely self-contained.
- Have exactly one deterministic correct solution.
- Include meaningful edge cases.
- Respect the provided constraints.
- Have an efficient optimal solution.
- Avoid ambiguity.
- Be suitable for automatic evaluation by an online judge.

The problem pattern should define the scenario; the topic defines the underlying concepts.`;
