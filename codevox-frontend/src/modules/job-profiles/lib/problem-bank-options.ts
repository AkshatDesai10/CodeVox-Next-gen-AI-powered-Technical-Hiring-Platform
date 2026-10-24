export const PROBLEM_TOPIC_TAG_OPTIONS = [
  'Data Structures',
  'Algorithms',
  'Dynamic Programming',
  'Math & Geometry',
  'Bit Manipulation',
  'Strings',
  'Object-Oriented Programming',
  'Concurrent Programming',
  'Database Design',
  'System Design',
] as const;

export type ProblemTopicTag = (typeof PROBLEM_TOPIC_TAG_OPTIONS)[number];

export type ProblemPatternGroup = {
  id: string;
  label: string;
  patterns: string[];
};

export const ERP_PATTERN_GROUPS: ProblemPatternGroup[] = [
  {
    id: 'admissions',
    label: 'Admissions & Enrollment',
    patterns: [
      'Online Application Submission',
      'Entrance Exam Merit List Generation',
      'Category / Quota Seat Allocation',
      'Document Verification Workflow',
      'Provisional Admission Letter',
      'Waitlist Movement & Upgrade',
      'Transfer / Lateral Entry Validation',
      'NRI / International Admission Track',
      'Admission Fee Payment Gate',
      'Anti-Ragging Affidavit Tracking',
      'Counseling Round Seat Allotment',
      'Migration Certificate Validation',
    ],
  },
  {
    id: 'academics',
    label: 'Student Records & Academics',
    patterns: [
      'Student ID / Roll Number Generation',
      'Program / Branch Change Request',
      'Credit Transfer Evaluation',
      'Academic Standing (Probation) Rules',
      'Transcript Generation',
      'Degree Audit / Graduation Eligibility',
      'Backlog / Re-appear Tracking',
      'Minor / Elective Credit Rules',
      'Academic Calendar Event Setup',
      'Student Status Lifecycle (Active / Alumni)',
      'Bonafide / Character Certificate Request',
      'Readmission After Break of Study',
    ],
  },
  {
    id: 'registration',
    label: 'Course Registration & Timetabling',
    patterns: [
      'Course Registration Window',
      'Prerequisite & Corequisite Check',
      'Seat Cap / Section Allocation',
      'Timetable Clash Detection',
      'Faculty Load Balancing',
      'Open Elective Bidding',
      'Add/Drop with Refund Rules',
      'Lab Batch Assignment',
      'Substitute Faculty Scheduling',
      'Exam Hall Seating Arrangement',
      'Bridge Course Enrollment',
      'Fast-Track / Honors Track Selection',
    ],
  },
  {
    id: 'exams',
    label: 'Examinations & Grading',
    patterns: [
      'Exam Registration & Fee',
      'Hall Ticket Generation',
      'Internal Assessment Marks Entry',
      'Grace Marks Policy Engine',
      'Relative Grading / Moderation',
      'Revaluation / Recount Request',
      'SGPA / CGPA Calculation',
      'Failed Subject Repeat Rules',
      'Exam Malpractice Case Workflow',
      'Result Publish & Withhold Rules',
      'Supplementary Exam Scheduling',
      'Viva / Practical Marks Aggregation',
    ],
  },
  {
    id: 'fees',
    label: 'Fees & Scholarships',
    patterns: [
      'Fee Structure by Category',
      'Installment Schedule Generation',
      'Late Fee Penalty Calculation',
      'Scholarship Eligibility Rules',
      'Fee Concession Approval',
      'Refund on Withdrawal',
      'Hostel / Transport Fee Bundle',
      'Payment Gateway Reconciliation',
      'Defaulter List & Registration Hold',
      'Sibling / Merit Discount Rules',
      'Education Loan Verification Hold',
      'Fee Waiver for Economically Weaker Section',
    ],
  },
  {
    id: 'faculty',
    label: 'Faculty & Staff HR',
    patterns: [
      'Faculty Onboarding',
      'Department Faculty Assignment',
      'Leave Application Approval',
      'Teaching Staff Payroll Run',
      'Guest Lecture Honorarium',
      'Workload / Credit Point Tracking',
      'Appraisal & Promotion Cycle',
      'Contract / Adjunct Faculty Payment',
      'Staff Attendance Biometric Sync',
      'Research Incentive Disbursement',
      'HOD Approval Delegation',
      'Faculty Substitution Coverage',
    ],
  },
  {
    id: 'hostel',
    label: 'Hostel & Campus Life',
    patterns: [
      'Hostel Room Allocation',
      'Room Change / Swap Request',
      'Mess Fee & Attendance',
      'Visitor Gate Pass',
      'Disciplinary Action Workflow',
      'Student Club Registration',
      'Transport Route Assignment',
      'Health Center Appointment',
      'Vacation Eviction Notice',
      'Warden Complaint Escalation',
      'Sports Facility Booking',
      'Campus Event Permission Request',
    ],
  },
  {
    id: 'library',
    label: 'Library & Learning Resources',
    patterns: [
      'Book Issue / Return Rules',
      'Overdue Fine Calculation',
      'Reserved Reading Room Slots',
      'Digital Resource Access Log',
      'Inter-Library Loan Request',
      'Thesis / Dissertation Deposit',
      'ISBN Catalog Import',
      'Membership Renewal by Role',
      'Plagiarism Hold on Issue',
      'Annual Library Stock Audit',
      'E-Journal Subscription Access',
      'Reference Section Time Slot',
    ],
  },
  {
    id: 'research',
    label: 'Research & Grants',
    patterns: [
      'Research Project Registration',
      'Grant Budget Utilization',
      'Ethics Committee Approval',
      'PhD Coursework Tracking',
      'Publication Incentive Claim',
      'Patent Filing Reimbursement',
      'Conference Travel Advance',
      'Co-PI Role Assignment',
      'Milestone Progress Report',
      'Grant Closure & Audit',
      'Supervisor Change Request',
      'Synopsis Submission Workflow',
    ],
  },
  {
    id: 'placement',
    label: 'Placements, Internships & Alumni',
    patterns: [
      'Company Drive Registration',
      'Placement Eligibility Rules',
      'Interview Slot Allocation',
      'Offer Letter Tracking',
      'Internship Credit Mapping',
      'Alumni Directory Update',
      'Mentorship Program Matching',
      'Donation / Endowment Recording',
      'Convocation Registration',
      'Degree Certificate Dispatch',
      'Pre-Placement Talk Attendance',
      'Dream / Super-Dream Offer Policy',
    ],
  },
  {
    id: 'master',
    label: 'Master Data & Configuration',
    patterns: [
      'Academic Year / Semester Setup',
      'Department & Program Master',
      'Course Catalog Versioning',
      'Grading Scale Configuration',
      'Role Matrix (Student / Faculty / Admin)',
      'Campus / Building / Room Master',
      'Fee Head & Ledger Mapping',
      'Notification Template Setup',
      'Duplicate Student Record Merge',
      'Bulk Import Validation (CSV)',
      'Regulation / Batch Curriculum Mapping',
      'Affiliated College Hierarchy Setup',
    ],
  },
  {
    id: 'reporting',
    label: 'Reporting & Accreditation',
    patterns: [
      'Enrollment Statistics Report',
      'Pass Percentage by Department',
      'Fee Collection Summary Query',
      'Faculty-Student Ratio Report',
      'NAAC / Accreditation Data Export',
      'AISHE / Government Return Filing',
      'Attendance Deficit Report',
      'Hostel Occupancy Dashboard',
      'Placement Outcome Analytics',
      'Audit Log Investigation Query',
      'Dropout & Retention Analysis',
      'Category-Wise Admission Statistics',
    ],
  },
  {
    id: 'workflow',
    label: 'Workflow, Security & Integration',
    patterns: [
      'Multi-Level Approval Workflow',
      'SSO / LDAP User Provisioning',
      'LMS Grade Sync Job',
      'Payment Gateway Webhook',
      'SMS / Email Notification Queue',
      'Document Digital Signature',
      'API Idempotent Student Sync',
      'Bulk Transaction Rollback',
      'Role-Based Module Access',
      'Data Privacy / Consent Tracking',
      'Parent Portal Read-Only Access',
      'Biometric Device Integration',
    ],
  },
];

const ERP_PATTERNS_FLAT = ERP_PATTERN_GROUPS.flatMap((group) => group.patterns);

export const PROBLEM_PATTERNS_BY_TOPIC: Record<ProblemTopicTag, string[]> = {
  Algorithms: [
    'Array & String Manipulation',
    'Sliding Window',
    'Two Pointers',
    'Binary Search',
    'Sorting & Custom Comparator',
    'Hash Map / Frequency Count',
    'Prefix Sum',
    'Greedy Selection',
    'Backtracking',
    'Graph Traversal (BFS/DFS)',
    'Shortest Path',
    'Topological Sort',
    'Union Find',
    'Recursion & Memoization',
    'Matrix Traversal',
    'Subarray / Substring Search',
  ],
  'Data Structures': [
    'Design LRU Cache',
    'Design LFU Cache',
    'Implement Min Stack',
    'Design a Queue / Deque',
    'Trie / Prefix Tree',
    'Heap / Priority Queue',
    'Linked List Operations',
    'Binary Tree Construction',
    'Interval Merging',
    'Design Hit Counter',
    'Design Rate Limiter (In-Memory)',
  ],
  'Dynamic Programming': [
    '1D Dynamic Programming',
    '2D Dynamic Programming',
    'Knapsack Problem',
    'Longest Increasing Subsequence',
    'Longest Common Subsequence',
    'State Machine DP',
    'DP on Trees',
    'Digit DP',
  ],
  'Math & Geometry': [
    'Prime Numbers & Sieve',
    'Modular Arithmetic',
    'Combinatorics',
    'Geometry / Rectangles',
    'Matrix Exponentiation',
  ],
  'Bit Manipulation': [
    'Bitwise Operators',
    'XOR Properties',
    'Counting Bits',
    'Bitmask DP',
  ],
  'Strings': [
    'String Matching (KMP)',
    'Palindrome / Anagram',
    'Regex / Parsing',
    'String Transformation',
    'Longest Common Prefix',
    'Suffix Array / Tree',
  ],
  'Object-Oriented Programming': [
    'Class & Interface Design',
    'Design Patterns (Singleton, Factory)',
    'State Machine Implementation',
    'Game Logic (Chess, Tic-Tac-Toe)',
    'Event Emitter / PubSub',
  ],
  'Concurrent Programming': [
    'Thread Synchronization',
    'Mutex / Semaphores',
    'Producer-Consumer Problem',
    'Deadlock Avoidance',
    'Asynchronous Task Runner',
  ],
  'Database Design': [
    // Basic Query Patterns
    'Find Nth Highest / Lowest Value',
    'Find Duplicate Records',
    'Find Records Without a Match (NOT EXISTS / LEFT JOIN NULL)',
    'Rank & Dense Rank',
    'Top N Per Group',
    'Consecutive Rows / Sequential Gaps',
    'Running Total / Cumulative Sum',
    'Moving Average',
    'Pivot / Cross-Tab Query',
    'Unpivot / Normalize Columns to Rows',
    // Joins & Relationships
    'Self Join (Employee-Manager Hierarchy)',
    'Many-to-Many Join with Aggregation',
    'Join & Aggregation Query',
    'Recursive CTE (Hierarchical Data)',
    'Multi-Table Join with Filtering',
    // Aggregation & Grouping
    'Group By with HAVING Filter',
    'Conditional Aggregation (SUM CASE WHEN)',
    'Reporting & Analytics Query',
    'Cohort Analysis',
    'Month-over-Month / Year-over-Year Comparison',
    // Subqueries & Set Operations
    'Correlated Subquery',
    'EXISTS / NOT EXISTS Pattern',
    'UNION / INTERSECT / EXCEPT',
    'Derived Table / Inline View',
    // String & Date Functions
    'String Manipulation Query (CONCAT, SUBSTRING, REPLACE)',
    'Date Arithmetic (DATEDIFF, DATE_ADD, EXTRACT)',
    'Pattern Matching (LIKE, REGEXP)',
    // Window Functions
    'Window Function — LAG / LEAD',
    'Window Function — FIRST_VALUE / LAST_VALUE',
    'Partitioned Ranking (ROW_NUMBER OVER PARTITION)',
    // Schema & Design
    'Schema Normalization (3NF)',
    'Index Design Decision',
    'Transaction & Locking Scenario',
    'Foreign Key & Referential Integrity Design',
    'Soft Delete Pattern',
    // Performance & Advanced
    'Query Optimization (Rewrite for Performance)',
    'Deadlock / Concurrency Scenario',
    'Stored Procedure / Function Design',
    'Trigger-Based Audit Log',
    'Materialized View / Summary Table Strategy',
  ],
  'System Design': [
    'URL Shortener Logic',
    'In-Memory Cache Layer',
    'Message Queue Consumer',
    'Load Balancer Routing Rule',
    'Session Store Implementation',
    'Rate Limiter Algorithm',
    'Consistent Hashing',
  ]
};

export const DEFAULT_PROBLEM_CONSTRAINTS = {
  inputSize: '1 ≤ n ≤ 10^5',
  valueRange: '1 ≤ val ≤ 10^9',
  memoryLimitMb: 256,
  timeLimitMs: 2000,
};

export type AiGeneratorType = 'coding' | 'database';

export type SeedSize = 'small' | 'medium' | 'large';

export const DATABASE_TYPE_OPTIONS = ['MySQL', 'PostgreSQL', 'SQLite', 'SQL Server'] as const;

export type DatabaseType = (typeof DATABASE_TYPE_OPTIONS)[number];

export const SEED_SIZE_OPTIONS: Array<{ value: SeedSize; label: string }> = [
  { value: 'small', label: 'Small (~3-5 tables)' },
  { value: 'medium', label: 'Medium (~5-8 tables)' },
  { value: 'large', label: 'Large (~8-12 tables)' },
];

export const AI_GENERATOR_OPTIONS: Array<{ value: AiGeneratorType; label: string; icon: string }> = [
  { value: 'coding', label: 'Coding Problem', icon: 'code' },
  { value: 'database', label: 'Database & SQL', icon: 'storage' },
];

export type ProblemGenerateOptions = {
  problemStatement: boolean;
  starterCode: boolean;
  internalSolution: boolean;
  testCases: boolean;
  complexityAnalysis: boolean;
  hints: boolean;
  databaseSchema: boolean;
  seedData: boolean;
};

export const DEFAULT_PROBLEM_GENERATE_OPTIONS: ProblemGenerateOptions = {
  problemStatement: true,
  starterCode: true,
  internalSolution: false,
  testCases: true,
  complexityAnalysis: true,
  hints: false,
  databaseSchema: true,
  seedData: true,
};

export const PROBLEM_GENERATE_OPTION_LABELS: Array<{ key: keyof ProblemGenerateOptions; label: string }> = [
  { key: 'problemStatement', label: 'Problem Statement' },
  { key: 'starterCode', label: 'Starter Code (per selected languages)' },
  { key: 'internalSolution', label: 'Internal Solution' },
  { key: 'testCases', label: '5 Test Cases (2 visible + 3 hidden)' },
  { key: 'complexityAnalysis', label: 'Complexity Analysis' },
  { key: 'databaseSchema', label: 'Sandbox Database Schema (DDL)' },
  { key: 'seedData', label: 'Sandbox Seed Data (INSERT SQL)' },
  { key: 'hints', label: 'Hints' },
];

const SANDBOX_DB_CODING_TOPICS: ProblemTopicTag[] = ['Database Design'];

const SANDBOX_DB_PATTERN_HINT =
  /query|sql|join|schema|report|transaction|index|migration|aggregat|employee|order|inventory|audit|database|cohort|enrollment|attendance|recruitment|sales|stock|timesheet|connection pool|deadlock|ledger|payroll|invoice|statement|register|student|faculty|semester|cgpa|sgpa|hostel|convocation|transcript|scholarship|placement|admission|exam|fee collection|naac|aishe|library|thesis|graduation|department|enrollment stat|pass percent|occupancy|retention|dropout/i;

export function topicNeedsSandboxDatabase(topic: string, pattern?: string): boolean {
  if (SANDBOX_DB_CODING_TOPICS.includes(topic as ProblemTopicTag)) {
    return true;
  }
  if (pattern && SANDBOX_DB_PATTERN_HINT.test(pattern)) return true;
  return false;
}

export type DatabaseGenerateOptions = {
  problemStatement: boolean;
  databaseSchema: boolean;
  seedData: boolean;
  entityDescriptions: boolean;
  relationships: boolean;
  sqlQueries: boolean;
  hints: boolean;
};

export const DEFAULT_DATABASE_GENERATE_OPTIONS: DatabaseGenerateOptions = {
  problemStatement: true,
  databaseSchema: true,
  seedData: true,
  entityDescriptions: true,
  relationships: true,
  sqlQueries: true,
  hints: false,
};

export const DATABASE_GENERATE_OPTION_LABELS: Array<{ key: keyof DatabaseGenerateOptions; label: string }> = [
  { key: 'problemStatement', label: 'SQL Problem Statement' },
  { key: 'databaseSchema', label: 'Database Schema (DDL)' },
  { key: 'seedData', label: 'Seed Data (INSERT SQL)' },
  { key: 'entityDescriptions', label: 'Entity Descriptions' },
  { key: 'relationships', label: 'Relationships' },
  { key: 'sqlQueries', label: 'Sample Interview Queries' },
  { key: 'hints', label: 'Hints' },
];

export function formatTestCaseValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function patternsForTopic(topic: string): string[] {
  return PROBLEM_PATTERNS_BY_TOPIC[topic as ProblemTopicTag] ?? [];
}

export function patternGroupsForTopic(topic: string): ProblemPatternGroup[] {
  const patterns = patternsForTopic(topic);
  if (!patterns.length) return [];
  return [{ id: 'suggested', label: 'Suggested patterns', patterns }];
}

export function isKnownProblemTopic(topic: string): topic is ProblemTopicTag {
  return PROBLEM_TOPIC_TAG_OPTIONS.includes(topic as ProblemTopicTag);
}
