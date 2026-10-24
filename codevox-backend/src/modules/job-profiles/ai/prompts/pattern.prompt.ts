export const PATTERN_GUIDANCE_PROMPT = `PROBLEM PATTERN GUIDANCE:
The problem pattern defines the real recruitment scenario shape; the topic tag defines underlying technical concepts.
Naturally combine both so the task feels like a credible technical screen or take-home — not a generic puzzle disconnected from the role.

Recruitment realism rules:
- Anchor the scenario in a believable context matching the job profile: university ERP, LMS, admissions, campus operations, fintech, etc.
- For University ERP patterns, use higher-education entities: students, faculty, departments, programs, semesters, courses, exams, fees, hostels, placements, accreditation.
- Calibrate scope to seniority: juniors get focused single-module tasks; seniors get multi-step workflows with edge cases and trade-offs.
- Prefer practical deliverables recruiters actually assess: correct business rules, clean API handlers, SQL that answers a reporting question, bug fixes in legacy code, data transforms on realistic inputs.
- The pattern name is the scenario blueprint — implement THAT scenario using the topic's techniques.

Example pattern → scenario mapping:
- "SGPA / CGPA Calculation" → compute semester and cumulative GPA with grace marks and failed-subject rules
- "Category / Quota Seat Allocation" → allot admission seats by merit within reserved categories without overfilling caps
- "Prerequisite & Corequisite Check" → validate course registration against curriculum rules and completed credits
- "Fee Collection Summary Query" → SQL report of collected vs pending fees by department and student category
- "Placement Eligibility Rules" → determine which students can sit for drives based on CGPA, backlogs, and attendance
- "Hostel Room Allocation" → assign rooms by year, gender, and availability without double booking
- "Rate Limiter Middleware" → enforce per-user API limits with sliding window logic
- "Fix Production Bug" → given buggy starter code, correct off-by-one / null handling / edge cases
- "CSV / JSON Parsing" → ingest messy student or marks records, validate schema, produce summary metrics
- "Design LRU Cache" → classic structure design with get/put in O(1) as a backend screening question`;
