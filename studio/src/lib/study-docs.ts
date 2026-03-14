export type StudyDocSection = {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
};

export type StudyDocChoice = {
  title: string;
  whyPick: string[];
  whyNot: string[];
  apply?: string[];
};

export type StudyDoc = {
  slug: string;
  title: string;
  category: "study" | "explore" | "review";
  summary: string;
  purpose: string;
  tags: string[];
  sections: StudyDocSection[];
  picks?: StudyDocChoice[];
  defers?: StudyDocChoice[];
  readingOrder?: string[];
};

export const STUDY_DOCS: StudyDoc[] = [
  {
    slug: "software-design-philosophy",
    title: "Software Design Philosophy",
    category: "explore",
    summary:
      "A distilled study document based on John Ousterhout's design philosophy, focused on reducing complexity, designing deep modules, and making software easier to change.",
    purpose:
      "Use this as a practical reading guide for code reviews, refactors, API design, and architectural decisions. The goal is to build the habit of spotting complexity early and pulling it downward instead of leaking it across the system.",
    tags: ["software design", "complexity", "architecture"],
    sections: [
      {
        title: "Core Thesis",
        paragraphs: [
          "The central problem of software design is complexity. Good design is not mainly about cleverness or compression, it is about making a system easier to understand and safer to change over time.",
          "Complexity accumulates incrementally. It usually appears through many small decisions that each feel harmless in isolation, which is why design quality requires steady discipline rather than occasional cleanup.",
        ],
      },
      {
        title: "How Complexity Shows Up",
        bullets: [
          "Change amplification: a small change forces edits in many places.",
          "Cognitive load: too much context is required to make a safe change.",
          "Unknown unknowns: it is unclear where to look or what else might break.",
          "Dependencies and obscurity are the two main root causes behind those symptoms.",
        ],
      },
      {
        title: "Strategic Programming",
        paragraphs: [
          "Tactical programming optimizes for getting the feature working right now. Strategic programming invests some development time in improving the surrounding design so future work gets easier instead of harder.",
        ],
        bullets: [
          "Spend part of each change improving abstraction quality, not only shipping behavior.",
          "Treat the increments of development as abstractions, not just features.",
          "Working code is not enough if the design gets worse every time it changes.",
        ],
      },
      {
        title: "Deep Modules",
        paragraphs: [
          "A deep module has a simple interface and hides a meaningful amount of internal complexity. A shallow module has a complicated interface but does very little.",
        ],
        bullets: [
          "Optimize for a simple common path.",
          "A simple interface matters more than a simple implementation.",
          "Prefer modules that hide complexity rather than exposing internal decisions through many parameters or methods.",
        ],
      },
      {
        title: "Information Hiding And Leakage",
        paragraphs: [
          "Modules should encapsulate design decisions so callers do not need to know about low-level structures, algorithms, or policies.",
        ],
        bullets: [
          "If the same design decision shows up in multiple modules, information has leaked.",
          "Temporal decomposition is a common trap: splitting code by order of execution instead of by hidden knowledge.",
          "When knowledge is shared across modules, merge it or move it behind one deeper abstraction.",
        ],
      },
      {
        title: "Layers And Generality",
        bullets: [
          "Adjacent layers should provide different abstractions, not just pass calls through unchanged.",
          "Pass-through methods and pass-through variables are warning signs that layering is weak.",
          "General-purpose modules are often deeper than special-purpose ones because they cover more use cases with a simpler interface.",
          "Keep general-purpose and special-purpose code separated so the shared abstraction stays clean.",
        ],
      },
      {
        title: "Pull Complexity Downward",
        paragraphs: [
          "When complexity cannot be removed, the module should absorb it internally instead of pushing it to every caller. A hard decision inside one module is usually better than forcing every user of the module to carry that burden.",
        ],
        bullets: [
          "Do not turn difficult design choices into endless configuration knobs by default.",
          "Do not leak recoverable low-level issues upward unless callers truly need to reason about them.",
          "Prefer interfaces that keep the burden on the implementation side.",
        ],
      },
      {
        title: "Define Errors Out Of Existence",
        paragraphs: [
          "Some of the best design work comes from redefining semantics so common edge cases stop being errors in the first place.",
        ],
        bullets: [
          "Use semantics like 'after this call, the key does not exist' instead of throwing when the key is already missing.",
          "Mask or aggregate low-level exceptions when callers do not benefit from handling them directly.",
          "This is not about ignoring real failures, it is about reducing unnecessary exception complexity.",
        ],
      },
      {
        title: "Comments, Naming, And Obvious Code",
        bullets: [
          "Comments should explain what the code does not make obvious: intent, constraints, and why a design exists.",
          "Names should be precise, consistent, and informative; vague names are design smell, not just style issues.",
          "If code is hard to explain clearly, the design may be wrong.",
          "The final test is obviousness: a reader should understand behavior with minimal mental effort.",
        ],
      },
      {
        title: "Red Flags To Watch For",
        bullets: [
          "Shallow modules.",
          "Information leakage.",
          "Temporal decomposition.",
          "Pass-through methods.",
          "Repetition of non-trivial logic.",
          "Vague names.",
          "Comments that only restate code.",
          "Interfaces contaminated with implementation details.",
          "Code that is technically correct but still non-obvious.",
        ],
      },
    ],
    readingOrder: [
      "Complexity symptoms and root causes",
      "Strategic vs tactical programming",
      "Deep modules",
      "Information hiding and leakage",
      "Pull complexity downward",
      "Define errors out of existence",
      "Comments, naming, and obvious code",
      "Red flags for code review",
    ],
  },
  {
    slug: "mission-control-system-design-priorities",
    title: "Mission Control System Design Priorities",
    category: "explore",
    summary:
      "A shortlist of the system design concepts worth learning now for Mission Control, with explicit reasons for what to implement and what to defer.",
    purpose:
      "Use this as both a learning document and an implementation backlog seed. The goal is to study the concepts that match Mission Control's current architecture instead of jumping to distributed-systems patterns that add complexity without solving a real problem.",
    tags: ["system design", "mission control", "architecture"],
    sections: [
      {
        title: "Current Shape",
        bullets: [
          "Local-first Next.js application with API routes and server-side services.",
          "Durable project data in SQLite plus workspace files on disk.",
          "Automation handoff to n8n and other local tools.",
          "Growing set of sidecar-style capabilities such as code graph, workspace intel, and automation endpoints.",
          "Likely failures are retries, long-running jobs, stale reads, and missing visibility rather than internet-scale traffic.",
        ],
      },
      {
        title: "How To Use This Document",
        paragraphs: [
          "Study the picks first. Each one maps to a failure mode or scaling edge that Mission Control can realistically hit soon.",
          "Treat the deferred items as guardrails. They are not bad ideas, they are just the wrong ideas to prioritize at the current product stage.",
        ],
      },
    ],
    picks: [
      {
        title: "Idempotency",
        whyPick: [
          "Mission Control already accepts writes from automation flows, reports, and quests.",
          "Retries from n8n, flaky local services, or user double-submits can create duplicate records.",
          "This is low implementation cost with immediate operational value.",
        ],
        whyNot: [
          "Do not jump to locks, consensus, or multi-region coordination first. Those solve problems the app does not have yet.",
        ],
        apply: [
          "Add idempotency keys to automation write endpoints.",
          "De-duplicate report and quest creation on stable request fingerprints.",
          "Log whether a request was replayed or newly applied.",
        ],
      },
      {
        title: "Push-First Progress Updates Using SSE",
        whyPick: [
          "Long-running operations need live status, and polling wastes requests and adds lag.",
          "Most progress flows in Mission Control are one-way server-to-client streams.",
          "SSE fits local-first status streaming with less complexity than WebSockets.",
        ],
        whyNot: [
          "Do not default to WebSockets when the client is mostly listening rather than continuously sending commands.",
        ],
        apply: [
          "Prefer SSE for job progress, automation state, indexing progress, and other one-way updates.",
          "Keep polling only as a fallback for simple or low-value surfaces.",
        ],
      },
      {
        title: "Explicit Async Jobs And Work Queues",
        whyPick: [
          "Workspace scans, code graph generation, imports, and exports do not scale well as synchronous requests.",
          "A job model gives progress, cancellation, retries, and better UX for heavy operations.",
          "This matches the direction already used in sidecar features such as transcription jobs.",
        ],
        whyNot: [
          "Do not bring in Kafka, RabbitMQ, or a distributed broker while Mission Control is still fundamentally local and single-node.",
        ],
        apply: [
          "Standardize job states such as queued, running, completed, failed, and canceled.",
          "Use jobs for code graph rebuilds, large doc imports, context exports, and future AI-heavy tasks.",
          "Expose job status consistently through API and SSE.",
        ],
      },
      {
        title: "Cache With Clear Invalidation Rules",
        whyPick: [
          "Mission Control already has in-process caches around workspace intel and code graph snapshots.",
          "The real risk is stale or inconsistent cache behavior, not absence of caching.",
          "Formal cache keys, TTLs, and invalidation rules improve both latency and correctness.",
        ],
        whyNot: [
          "Do not add distributed cache layers or CDN-style complexity before the app has a scale problem that justifies them.",
        ],
        apply: [
          "Document which reads are cacheable and for how long.",
          "Invalidate caches on file changes, project switches, and write endpoints that affect derived views.",
          "Surface whether a response came from cache or fresh computation.",
        ],
      },
      {
        title: "Rate Limiting And Backpressure",
        whyPick: [
          "Automation endpoints can be hit by loops, retries, or misconfigured workflows.",
          "Local tools can still overwhelm a single-node app if they flood graph or automation routes.",
          "This becomes more important as more sidecars and agents call into Mission Control.",
        ],
        whyNot: [
          "Do not start with an API gateway. The immediate problem is request discipline inside the app, not edge-network complexity.",
        ],
        apply: [
          "Protect automation, import, and graph-building routes first.",
          "Return explicit 429 responses with retry guidance.",
          "Add concurrency caps for expensive work, not just request-per-minute limits.",
        ],
      },
      {
        title: "Tracing And Correlated Logs",
        whyPick: [
          "Mission Control spans UI actions, API routes, workspace scans, server services, and local automation calls.",
          "Failures will increasingly be multi-step and hard to debug without shared request or job IDs.",
          "This gives strong value before a full observability stack is needed.",
        ],
        whyNot: [
          "Do not start with a heavyweight tracing platform when structured logs and correlation IDs will solve most near-term debugging needs.",
        ],
        apply: [
          "Attach request IDs and job IDs across API boundaries.",
          "Log external tool calls with duration, status, and target service.",
          "Show trace IDs in error payloads and debug views.",
        ],
      },
    ],
    defers: [
      {
        title: "Microservices, Service Discovery, And Heartbeats",
        whyPick: [],
        whyNot: [
          "Mission Control is still easier to operate as a local-first application with a few known sidecars.",
          "Static local configuration is enough while service count stays low and topology stays predictable.",
        ],
      },
      {
        title: "Distributed Locks, Consensus, And Gossip",
        whyPick: [],
        whyNot: [
          "These solve coordination problems Mission Control does not currently have.",
          "Introducing them now would be architecture theater.",
        ],
      },
      {
        title: "Sharding, Consistent Hashing, And Multi-Node Data Distribution",
        whyPick: [],
        whyNot: [
          "Current constraints are product maturity and workflow clarity, not storage scale.",
          "SQLite and local workspace data are still the right defaults for the current stage.",
        ],
      },
      {
        title: "WebSockets-First Architecture",
        whyPick: [],
        whyNot: [
          "Most Mission Control interactions are CRUD, document views, and one-way progress streams.",
          "WebSockets would add complexity without changing the product meaningfully today.",
        ],
      },
      {
        title: "Event-Driven Everything",
        whyPick: [],
        whyNot: [
          "Mission Control still benefits from explicit request-response flows for clarity and debuggability.",
          "Event-driven patterns should be introduced selectively around jobs and automations, not across the whole app.",
        ],
      },
    ],
    readingOrder: [
      "Idempotency",
      "Rate Limiting",
      "Long Polling vs WebSockets",
      "Pub/Sub and Message Queues",
      "Caching Strategies",
      "Distributed Tracing",
    ],
  },
  {
    slug: "cryptography-network-security-midterm-2025-2026",
    title: "Cryptography and Network Security — Midterm e-Material (2025-2026)",
    category: "study",
    summary:
      "Mid-semester study pack covering core network security and cryptography concepts, plus MCQ-style exam practice and short-answer definitions.",
    purpose:
      "Use this as your revision anchor for the Cryptography and Network Security midterm: review core concepts first, then practice quick recall with MCQ and short-answer prompts.",
    tags: ["cryptography", "network security", "midterm", "study guide"],
    sections: [
      {
        title: "Core Concepts to Know",
        bullets: [
          "Authentication: verify identity of user/device.",
          "Confidentiality: keep information secret from unauthorized parties.",
          "Integrity: ensure data has not been altered.",
          "Availability: ensure systems/data are accessible when needed.",
          "CIA Triad = Confidentiality + Integrity + Availability.",
          "Network security goal: protect networks/data from unauthorized access and threats.",
        ],
      },
      {
        title: "Cryptography Fundamentals",
        bullets: [
          "Cryptosystem components: plaintext, ciphertext, key(s).",
          "Symmetric encryption uses the same key for encrypt/decrypt.",
          "Asymmetric encryption uses public/private key pair.",
          "Cryptanalysis: analyze ciphers to find weaknesses.",
          "Brute force, chosen plaintext, chosen ciphertext, and man-in-the-middle are important attack models.",
        ],
      },
      {
        title: "Classical + Modern Algorithms",
        bullets: [
          "Caesar cipher: shift substitution (e.g., key +3 or generalized shift).",
          "Playfair: digraph substitution cipher.",
          "DES: Feistel-based block cipher (permutation/substitution rounds).",
          "AES: symmetric block cipher, 128-bit key uses 10 rounds.",
          "RSA: public-key cryptography with modular arithmetic.",
          "ECC: shared secret derived from private key × other party public point.",
        ],
      },
      {
        title: "Hashing + Message Authentication",
        bullets: [
          "Birthday attack targets collision probability in hash functions.",
          "MAC (Message Authentication Code) ensures authenticity + integrity.",
          "Hashing is not encryption; it is one-way digest computation.",
        ],
      },
      {
        title: "Short-Answer Revision Prompts",
        bullets: [
          "Define confidentiality and authentication.",
          "Define cryptography and computer security.",
          "Encrypt 'KIT' using Caesar with key=15 (expected: ZXI).",
          "List Feistel design parameters (block size, key size, rounds, subkey generation, round function, etc.).",
          "List DES modes: ECB, CBC, CFB, OFB, CTR.",
        ],
      },
      {
        title: "Exam Strategy (Fast Recall)",
        bullets: [
          "First pass: answer direct-definition MCQs quickly.",
          "Second pass: solve algorithm/parameter questions (AES rounds, RSA math, DES properties).",
          "For short answers: use concise textbook definitions with key terms.",
          "Double-check terms that are commonly confused: authentication vs authorization, encryption vs hashing, MAC vs signature.",
        ],
      },
    ],
    readingOrder: [
      "Core Concepts to Know",
      "Cryptography Fundamentals",
      "Classical + Modern Algorithms",
      "Hashing + Message Authentication",
      "Short-Answer Revision Prompts",
      "Exam Strategy (Fast Recall)",
    ],
  },
  {
    slug: "web-project-foundations-and-architecture-decisions",
    title: "Web Project Foundations And Architecture Decisions",
    category: "explore",
    summary:
      "A comprehensive reference for understanding npm, npx, Nx, monoliths, microservices, monorepos, React, Next.js, and practical authentication strategy.",
    purpose:
      "Use this document when choosing a stack, repository structure, app architecture, or auth approach for a student project, startup MVP, or growing product. The goal is to separate concepts that are often mixed together and make better technical decisions with less confusion.",
    tags: ["web development", "architecture", "react", "next.js", "authentication"],
    sections: [
      {
        title: "How To Read This Document",
        paragraphs: [
          "These topics are often confused because they sit at different layers of software development. Some describe package management, some describe repository structure, some describe deployment architecture, and some describe frontend framework choices.",
          "The clean way to understand them is to ask one question for each term: what problem does this thing solve? Once you map each term to its job, the comparison becomes much easier.",
        ],
        bullets: [
          "npm and npx are about working with Node packages and package executables.",
          "Nx is about managing large workspaces and monorepos.",
          "Monolith and microservices are about system architecture.",
          "Monorepo and polyrepo are about code organization in Git.",
          "React and Next.js are about frontend and full-stack web development.",
          "Authentication strategy is about how much of the login and access system you standardize versus customize.",
        ],
      },
      {
        title: "npm",
        paragraphs: [
          "npm is the package manager that sits at the center of most Node.js projects. In practice, it is the tool that reads package.json, installs dependencies, runs scripts, and manages local project packages.",
          "People often think of npm only as an install command, but it is broader than that. It is also the default dependency manager, script runner, and workspace manager for many JavaScript and TypeScript projects.",
        ],
        bullets: [
          "Use npm to install libraries such as React, Next.js, Express, Prisma, or Tailwind.",
          "Use npm to run project scripts like dev, build, lint, test, and typecheck.",
          "Use npm to manage local package versions and project dependencies.",
          "Use npm workspaces if one repository contains multiple local packages or apps.",
        ],
      },
      {
        title: "npx",
        paragraphs: [
          "npx is for running a package executable without needing to install it globally first. It is best understood as a command runner for package-based CLI tools.",
          "This makes it useful for one-time setup commands, generators, scaffolding tools, and CLIs you do not want to keep installed globally on your machine.",
        ],
        bullets: [
          "Use npx for commands like create-next-app, prisma, shadcn, or create-nx-workspace.",
          "Use it when you want to run a tool immediately and do not want to manage a global install.",
          "Use it when you want a specific or latest package version for a setup command.",
          "Think of npm install as adding a tool to the project, and npx as just running a tool right now.",
        ],
      },
      {
        title: "Nx",
        paragraphs: [
          "Nx is not a package manager and not a command runner in the same sense as npm or npx. It is a workspace and build orchestration tool designed for larger monorepos.",
          "Nx becomes useful when a codebase contains multiple apps, shared libraries, and many tasks that need to stay fast and organized as the repository grows.",
        ],
        bullets: [
          "It provides dependency graphs across apps and libraries.",
          "It improves task execution with caching and affected-task detection.",
          "It helps coordinate builds, tests, linting, and generation across a large workspace.",
          "It is most useful after a repository has become multi-app or operationally noisy.",
        ],
      },
      {
        title: "npm vs npx vs Nx",
        paragraphs: [
          "These tools are related, but they do not compete directly because they solve different problems. npm manages packages, npx runs package executables, and Nx manages large workspaces and task orchestration.",
          "A normal workflow can use all three together without conflict. For example, npx can bootstrap an Nx workspace, npm can install dependencies, and Nx can run workspace-specific development commands.",
        ],
        bullets: [
          "npm = install and manage packages, dependencies, and scripts.",
          "npx = run package commands, especially one-off CLIs.",
          "Nx = manage a growing monorepo with better structure and faster task execution.",
          "Choose npm by default, npx for setup and tools, and Nx only when the workspace complexity justifies it.",
        ],
      },
      {
        title: "Monolith",
        paragraphs: [
          "A monolith is an application architecture where the system is built and deployed as one main application. Features may be internally separated into modules, but they still live inside one main deployable unit.",
          "This does not automatically mean the code is messy. A monolith can be well-structured internally; the key point is that the system remains one primary application rather than many separately deployed services.",
        ],
        bullets: [
          "Common for school projects, MVPs, and early-stage products.",
          "Usually means simpler local development and simpler deployment.",
          "Often works well with one backend app and one main database.",
          "Becomes difficult only when internal structure, ownership, or scaling concerns are ignored for too long.",
        ],
      },
      {
        title: "Microservices",
        paragraphs: [
          "Microservices split the system into multiple smaller services, each handling a narrower responsibility such as auth, payments, notifications, or analytics.",
          "This architecture makes independence easier for mature teams, but it also introduces much more operational complexity, especially around local development, communication, deployment, logging, and debugging.",
        ],
        bullets: [
          "Useful when services need independent ownership or scaling.",
          "Useful when boundaries are mature and the team can support operational complexity.",
          "Usually overkill for student projects, small teams, or products still searching for product fit.",
          "Distributed debugging, network failures, and infrastructure complexity are the real costs.",
        ],
      },
      {
        title: "Monorepo",
        paragraphs: [
          "A monorepo is not an architecture. It is a repository structure where one Git repository contains multiple apps, packages, libraries, or services.",
          "A monorepo can contain a monolith, multiple frontends, multiple services, shared UI libraries, or all of the above. It only describes how the code is stored and managed in source control.",
        ],
        bullets: [
          "Good for shared libraries and coordinated refactors.",
          "Good when multiple apps must evolve together.",
          "Pairs well with workspace tools like npm workspaces, pnpm workspaces, Turborepo, or Nx.",
          "Does not automatically mean the system is microservices.",
        ],
      },
      {
        title: "Polyrepo",
        paragraphs: [
          "Polyrepo means each app, service, or package lives in its own Git repository. This can create cleaner isolation, but also introduces duplication and more coordination overhead between related systems.",
          "For example, a frontend, admin panel, backend API, and shared component library could each live in their own separate repository.",
        ],
        bullets: [
          "Good when teams need strong isolation or separate permissions.",
          "Often harder for cross-project refactors and shared code management.",
          "Can create duplicated tooling, setup, and release processes.",
          "Makes sense when projects truly operate independently.",
        ],
      },
      {
        title: "Architecture vs Repository Structure",
        paragraphs: [
          "This is one of the most important distinctions in this topic set. Monolith versus microservices describes how the system is built and deployed. Monorepo versus polyrepo describes how the code is stored in Git.",
          "Because they answer different questions, they can be combined in multiple ways. A monolith can live in a monorepo or a polyrepo, and a microservice system can also live in either.",
        ],
        bullets: [
          "Monolith + monorepo is common for teams with one main app plus internal packages.",
          "Monolith + polyrepo is possible when the app is isolated in one dedicated repo.",
          "Microservices + monorepo can work when many services share tooling and ownership.",
          "Microservices + polyrepo can work when each service is strongly independent.",
        ],
      },
      {
        title: "What Most Students And Small Teams Should Choose",
        paragraphs: [
          "For most student projects and small team products, the best default is a monolith first. It gives the most learning value with the least operational overhead.",
          "If the repository only contains one app, a normal single repo is enough. If multiple related apps or shared libraries appear later, then a monorepo starts to make sense.",
        ],
        bullets: [
          "Start with a monolith unless you have a very clear reason not to.",
          "Use a monorepo only when multiple apps or packages genuinely exist.",
          "Do not reach for microservices just to look advanced.",
          "Optimize first for clarity, speed, and maintainability.",
        ],
      },
      {
        title: "React",
        paragraphs: [
          "React is a UI library focused on building component-based interfaces. It handles the view layer and client-side UI logic, including components, props, state, and hooks.",
          "By itself, React does not define your entire app structure. If you use plain React, you still choose routing, bundling, data fetching patterns, API integration patterns, and deployment strategy.",
        ],
        bullets: [
          "Best when learning frontend fundamentals.",
          "Best when building a frontend-only SPA against a separate backend.",
          "Commonly paired with Vite in simpler frontend projects.",
          "Gives flexibility, but also requires more decisions from you.",
        ],
      },
      {
        title: "Next.js",
        paragraphs: [
          "Next.js is a React framework that adds a structured, production-ready application model around React. It gives routing, server rendering options, route handlers, optimizations, and a cleaner full-stack path in one framework.",
          "This is why the practical comparison is not React versus Next.js as if they were unrelated. Next.js uses React; the real choice is usually plain React versus React with a full framework.",
        ],
        bullets: [
          "Built-in file-based routing.",
          "Supports server rendering, static generation, and server components.",
          "Includes backend features like route handlers.",
          "Usually a better default for real web products than plain React alone.",
        ],
      },
      {
        title: "React vs Next.js In Practice",
        paragraphs: [
          "If you only need a frontend SPA and want to focus on UI fundamentals, plain React is often enough. If you want a complete web app with routing, server-side behavior, and one cohesive setup, Next.js is usually more practical.",
          "This is why many portfolio sites, dashboards, SaaS products, and startup apps use Next.js: it reduces setup friction while still using React as the core UI system.",
        ],
        bullets: [
          "Choose plain React when frontend-only control matters more than framework convenience.",
          "Choose Next.js when you want a full app with routing and server-side capabilities.",
          "Plain React is excellent for learning the fundamentals.",
          "Next.js is excellent for shipping a real product quickly.",
        ],
      },
      {
        title: "Authentication Without Heavy Customization",
        paragraphs: [
          "A less customized authentication approach means you adopt standard login methods, session handling, and provider flows with minimal changes. This is usually the safest and fastest path.",
          "The value here is not originality. The value is reducing security risk by relying on proven authentication infrastructure instead of re-implementing sensitive pieces yourself.",
        ],
        bullets: [
          "Use standard email/password and OAuth flows where possible.",
          "Use established tools like Auth.js, Clerk, Supabase Auth, Auth0, or Firebase Auth.",
          "Customize styling and app-specific access logic only where needed.",
          "This is usually the right default for student projects and MVPs.",
        ],
      },
      {
        title: "Customized Authentication",
        paragraphs: [
          "Customized authentication becomes necessary when your product has complex business rules that go beyond standard sign-in and sign-up behavior. The important distinction is that this usually means customizing authorization and onboarding logic around auth, not rebuilding auth primitives from scratch.",
          "Examples include multi-role onboarding, approval-based access, custom verification requirements, or organization-specific permissions.",
        ],
        bullets: [
          "Useful when the business requires role approval or verification workflows.",
          "Useful when different user types have different onboarding states.",
          "Useful when the access model is part of the product itself.",
          "Dangerous if you try to reinvent secure password, session, or OAuth internals unnecessarily.",
        ],
      },
      {
        title: "The Smart Middle Ground For Auth",
        paragraphs: [
          "The best practice for most teams is to standardize the authentication core and customize the business logic around it. In other words, let a trusted provider handle passwords, OAuth, sessions, and core identity concerns, while your application handles roles, approvals, onboarding state, and permissions.",
          "This gives you both safety and flexibility. You reduce security mistakes in the sensitive parts while still modeling the product-specific behavior your app actually needs.",
        ],
        bullets: [
          "Do not build password hashing or session token logic from scratch unless absolutely necessary.",
          "Do build role systems, approval states, verification flags, and access rules inside your app.",
          "Treat authentication and authorization as related but distinct concerns.",
          "This approach is usually the cleanest architecture for business-heavy apps.",
        ],
      },
      {
        title: "Concrete Example For Role-Based Apps",
        paragraphs: [
          "Suppose a buyer can sign up immediately, but a driver or farmer must submit identity information and wait for approval before role-specific features unlock. That is not a reason to build authentication from scratch.",
          "Instead, use a standard auth system for login and sessions, then model role requests and approval state in your own database. That way, authentication remains stable while your business workflow stays fully customizable.",
        ],
        bullets: [
          "Base auth can remain email/password or OAuth.",
          "Store fields like role, requestedRole, and verificationStatus in your own app.",
          "Use admin approval to unlock restricted dashboards or permissions.",
          "This keeps the architecture secure, extensible, and easier to maintain.",
        ],
      },
      {
        title: "Practical Recommendations",
        paragraphs: [
          "For most student and early product work, the right pattern is not to maximize complexity. It is to choose the minimum architecture that still gives you clear learning value and room to grow later.",
          "That usually means using npm for normal package management, npx for setup commands, Next.js for real web apps, a monolith as the starting architecture, and standard auth with custom business rules around it.",
        ],
        bullets: [
          "Use npm as the default package manager.",
          "Use npx for scaffolding and one-off CLI commands.",
          "Add Nx only when the repo is truly multi-app or task-heavy.",
          "Start with a monolith unless scaling or team boundaries clearly demand otherwise.",
          "Prefer Next.js for production-style student and startup web apps.",
          "Use a standard auth core plus custom permissions and onboarding logic.",
        ],
      },
      {
        title: "Final Mental Model",
        bullets: [
          "npm, npx, and Nx are tooling decisions, not architecture decisions.",
          "Monolith and microservices are architecture choices, not Git structure choices.",
          "Monorepo and polyrepo are source control organization choices, not deployment choices.",
          "React is the UI foundation; Next.js is a fuller framework built on top of it.",
          "Authentication should usually be standardized at the core and customized at the business-rule layer.",
          "The best early technical decisions usually reduce complexity instead of increasing it.",
        ],
      },
    ],
    readingOrder: [
      "npm, npx, and Nx",
      "Monolith vs microservices",
      "Monorepo vs polyrepo",
      "React vs Next.js",
      "Authentication strategy",
      "What to choose for student and small-team projects",
    ],
  },
];

export function getStudyDoc(slug: string): StudyDoc | undefined {
  return STUDY_DOCS.find((doc) => doc.slug === slug);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export function studyDocWordCount(doc: StudyDoc): number {
  const content = [
    doc.title,
    doc.summary,
    doc.purpose,
    ...doc.sections.flatMap((section) => [
      section.title,
      ...(section.paragraphs ?? []),
      ...(section.bullets ?? []),
    ]),
    ...(doc.picks ?? []).flatMap((choice) => [
      choice.title,
      ...choice.whyPick,
      ...choice.whyNot,
      ...(choice.apply ?? []),
    ]),
    ...(doc.defers ?? []).flatMap((choice) => [
      choice.title,
      ...choice.whyNot,
    ]),
    ...(doc.readingOrder ?? []),
  ].join(" ");

  const words = content.trim().match(/\S+/g);
  return words ? words.length : 0;
}

export function studyDocToMarkdown(doc: StudyDoc): string {
  const lines: string[] = [
    `# ${doc.title}`,
    "",
    doc.summary,
    "",
    doc.purpose,
    "",
  ];

  for (const section of doc.sections) {
    lines.push(`## ${section.title}`, "");

    for (const paragraph of section.paragraphs ?? []) {
      lines.push(paragraph, "");
    }

    for (const bullet of section.bullets ?? []) {
      lines.push(`- ${bullet}`);
    }

    if ((section.bullets ?? []).length > 0) {
      lines.push("");
    }
  }

  if (doc.picks?.length) {
    lines.push("## Pick Now", "");

    for (const choice of doc.picks) {
      lines.push(`### ${choice.title}`, "", "#### Why Pick", "");
      for (const item of choice.whyPick) {
        lines.push(`- ${item}`);
      }
      lines.push("", "#### Why Not Bigger", "");
      for (const item of choice.whyNot) {
        lines.push(`- ${item}`);
      }

      if (choice.apply?.length) {
        lines.push("", "#### Apply Later", "");
        for (const item of choice.apply) {
          lines.push(`- ${item}`);
        }
      }

      lines.push("");
    }
  }

  if (doc.defers?.length) {
    lines.push("## Defer For Now", "");

    for (const choice of doc.defers) {
      lines.push(`### ${choice.title}`, "");
      for (const item of choice.whyNot) {
        lines.push(`- ${item}`);
      }
      lines.push("");
    }
  }

  if (doc.readingOrder?.length) {
    lines.push("## Reading Order", "");
    doc.readingOrder.forEach((item, index) => {
      lines.push(`${index + 1}. ${item}`);
    });
    lines.push("");
  }

  return lines.join("\n").trim();
}

export function studyDocToHtml(doc: StudyDoc): string {
  const lines: string[] = [
    `<p>${escapeHtml(doc.summary)}</p>`,
    `<p>${escapeHtml(doc.purpose)}</p>`,
  ];

  for (const section of doc.sections) {
    lines.push(`<h2>${escapeHtml(section.title)}</h2>`);

    for (const paragraph of section.paragraphs ?? []) {
      lines.push(`<p>${escapeHtml(paragraph)}</p>`);
    }

    if (section.bullets?.length) {
      lines.push("<ul>");
      for (const bullet of section.bullets) {
        lines.push(`<li>${escapeHtml(bullet)}</li>`);
      }
      lines.push("</ul>");
    }
  }

  if (doc.picks?.length) {
    lines.push("<h2>Pick Now</h2>");
    lines.push("<p>These are the concepts worth learning and implementing first.</p>");

    for (const choice of doc.picks) {
      lines.push(`<h3>${escapeHtml(choice.title)}</h3>`);
      lines.push("<p><strong>Why Pick</strong></p>");
      lines.push("<ul>");
      for (const item of choice.whyPick) {
        lines.push(`<li>${escapeHtml(item)}</li>`);
      }
      lines.push("</ul>");

      lines.push("<p><strong>Why Not Bigger</strong></p>");
      lines.push("<ul>");
      for (const item of choice.whyNot) {
        lines.push(`<li>${escapeHtml(item)}</li>`);
      }
      lines.push("</ul>");

      if (choice.apply?.length) {
        lines.push("<p><strong>Apply Later</strong></p>");
        lines.push("<ul>");
        for (const item of choice.apply) {
          lines.push(`<li>${escapeHtml(item)}</li>`);
        }
        lines.push("</ul>");
      }
    }
  }

  if (doc.defers?.length) {
    lines.push("<h2>Defer For Now</h2>");

    for (const choice of doc.defers) {
      lines.push(`<h3>${escapeHtml(choice.title)}</h3>`);
      lines.push("<ul>");
      for (const item of choice.whyNot) {
        lines.push(`<li>${escapeHtml(item)}</li>`);
      }
      lines.push("</ul>");
    }
  }

  if (doc.readingOrder?.length) {
    lines.push("<h2>Reading Order</h2>");
    lines.push(
      "<p>Work through these in order if you want the shortest path from theory to future implementation choices.</p>",
    );
    lines.push("<ol>");
    for (const item of doc.readingOrder) {
      lines.push(`<li>${escapeHtml(item)}</li>`);
    }
    lines.push("</ol>");
  }

  return lines.join("");
}
