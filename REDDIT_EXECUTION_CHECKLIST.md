### Reddit Scraping + Insight + Engagement Execution Checklist (Agent Handoff)

This checklist is the “how” companion to `REDDIT_STRATEGY.md` (the “why/what”).
Use this doc to assign agents, track deliverables, and validate completion.

---

### Roles (recommended)
- **Data/Backend Agent (DE)**: `.json` crawler implementation + scheduling + checkpointing + storage/normalization
- **NLP/Insights Agent (NLP)**: labeling, theme extraction, ranking, dashboards/reports
- **Community Agent (CM)**: posts/comments execution + community-safe workflows
- **CEO (You)**: guardrails, approvals, positioning, final publishing voice

---

### Global acceptance criteria (must hold across everything)
- **Compliance**: Reddit ToS + subreddit rules respected; best-effort rate-limit safe.
- **Data minimization**: only store fields listed in `REDDIT_STRATEGY.md` unless explicitly approved.
- **Reproducible**: one-command setup; documented configuration; stable incremental runs.
- **Auditable**: logs of each run + error handling + checkpointing.
- **Actionable outputs**: weekly Pain Map and daily “threads to engage” list.

---

### Milestone 0 — Policy + access readiness (Owner: CEO + DE)

#### Tasks
- **CEO**: confirm engagement policy
  - No spam
  - Transparency when posting/commenting
  - Link policy depends on subreddit rules
- **DE**: define User-Agent string including contact email
- **DE**: validate `.json` access for target subreddits using a simple fetch test

#### Deliverables
- **Config**: `.env` (local only) or environment variables including:
  - `REDDIT_USER_AGENT`
  - `SUBREDDITS` (comma-separated)
  - `DB_PATH`

#### Definition of done
- DE can fetch these endpoints successfully (200 OK) with a real User-Agent:
  - `https://www.reddit.com/r/AgentsofAI/new.json`
  - `https://www.reddit.com/r/AI_Agents/new.json`

---

### Milestone 1 — Subreddit listing crawler (Owner: DE)

#### Tasks
- Implement the **subreddit listing** fetcher using public `.json` listing feeds:
  - `https://www.reddit.com/r/<sub>/new.json`
  - `https://www.reddit.com/r/<sub>/hot.json`
  - `https://www.reddit.com/r/<sub>/top.json?t=day`
- Support pagination using `after` (fullname) until:
  - you reach `limit` pages, or
  - you hit a checkpoint, or
  - the feed ends (`after = null`)
- Checkpointing (per subreddit + feed):
  - store last processed `after` and/or `last_created_utc` in `subreddit_checkpoints`
- Parse minimal post fields and **upsert posts** idempotently.
- Rate limiting + robustness:
  - backoff on 429/5xx
  - bounded retries
  - log failures with enough context to rerun safely

#### Deliverables
- CLI command(s) to ingest posts by feed, e.g.:
  - `ingest-posts --feed new`
  - `ingest-posts --feed hot`
  - `ingest-posts --feed top --time-filter day`
- Verified stored posts in DB for both subreddits.

#### Definition of done
- Running the listing crawler twice produces **no duplicates** and updates signals cleanly (idempotent upsert).

---

### Milestone 2 — Scheduled listing runs (Owner: DE)

#### Tasks
- Define the scheduled run set:
  - “new” polling (10–20 min cadence) per subreddit
  - daily “hot” snapshot per subreddit
  - daily “top” snapshot per subreddit (use consistent time filter, e.g. `t=day`)
- Implement scheduling (Windows Task Scheduler is acceptable).
- Logging:
  - each run produces a timestamped output folder
  - capture stdout/stderr to a log file

#### Deliverables
- `scheduler_runbook.md`:
  - exact scheduled tasks + exact CLI commands
  - frequency
  - where logs live
  - how to pause/resume
- Verified scheduled runs producing outputs for 24 hours.

#### Definition of done
- A 24-hour schedule produces stable outputs with no repeated failures and no credential leaks.

---

### Milestone 3 — Post thread (comments) crawler (Owner: DE)

#### Tasks
- Define a “high-signal” heuristic for which posts get thread scraping (examples):
  - `num_comments` >= threshold
  - `score` >= threshold
  - post appears in daily hot/top
  - manually selected for engagement
- For each selected post, fetch the full thread via:
  - `https://www.reddit.com<permalink>.json`
- Parse:
  - post data from array element `[0]`
  - comment tree from array element `[1]` (ignore `"more"` placeholders)
- Upsert comments into `comments` table idempotently (by comment `id`) and map:
  - `post_id`
  - `parent_id`
  - `permalink`

#### Deliverables
- `comment_scrape_policy.md` (heuristic + cadence)
- CLI command to ingest threads/comments for selected posts (by ID list, time window, or heuristic).
- Example successful thread ingests for at least 20 posts (spot-checkable).

#### Definition of done
- For a sample of 20 high-engagement posts, comment coverage is “good enough” (validated by spot-check vs Reddit UI).

---

### Milestone 4 — Normalize into an analysis dataset (Owner: DE)

#### Tasks
- Ensure DB tables contain the minimum analysis fields from `REDDIT_STRATEGY.md` for:
  - posts
  - comments
- Add/confirm run metadata for reproducibility:
  - `scraped_at`
  - `source_endpoint` (e.g., `/r/<sub>/new.json`, `<permalink>.json`)
  - optional `api_response_version` if you decide to use it
- Export normalized datasets for NLP to consume (CSV/JSONL), or provide stable SQL views/queries.

#### Deliverables
- `data_normalization.md` describing:
  - normalized outputs
  - field mappings (listing vs thread)
- Normalized datasets under `data_processed/` (or a DB) that NLP can consume.

#### Definition of done
- NLP can run labeling on the normalized dataset without needing to understand crawler internals.

---

### Milestone 5 — NLP labeling + theme extraction (Owner: NLP)

#### Tasks
- Implement labeling:
  - Complaint/Pain
  - Help request
  - Tooling comparison
  - Workflow/process
  - Showcase/results
- Extract:
  - Theme (controlled taxonomy + “other”)
  - Stage (experiment/prototype/prod)
  - Stack mentions (best-effort)
  - Desired outcome (short phrase)
- Compute “Impact Score” from `REDDIT_STRATEGY.md`
- Create dedupe logic for near-identical content

#### Deliverables
- `taxonomy.md` defining themes and label guidelines
- `daily_insights.json` (or table) with ranked items to act on

#### Definition of done
- Spot-check 50 labeled items: labels are consistent enough to drive content decisions.

---

### Milestone 6 — Reporting + dashboards (Owner: NLP)

#### Tasks
- Build a weekly “ICP Pain Map” generator:
  - Top complaints + quotes + permalinks
  - Jobs-to-be-done
  - Blockers to shipping
  - Praised patterns/tools
- Build a daily “Engagement Queue”:
  - Threads to comment on
  - Unanswered help requests
  - Trending themes vs prior week

#### Deliverables
- `reports/weekly_pain_map.md` (generated)
- `reports/daily_engagement_queue.md` (generated)

#### Definition of done
- CEO can read the outputs in <10 minutes and decide:
  - what to build next
  - what to post/comment this week

---

### Milestone 7 — Metrics + iteration loop (Owner: CEO)

#### Tasks
- Define and track:
  - community signals (replies/upvotes/DMs)
  - traffic to Reddit-friendly landing page
  - resource usage
  - pipeline mentions of Reddit
- Run a monthly retro:
  - what themes rose/fell
  - which responses worked
  - which resource assets converted

#### Deliverables
- `metrics_dashboard.md` with the exact metrics and how to compute them
- Monthly retro notes

#### Definition of done
- You can confidently answer: “What are they complaining about this month, and what did we do about it?”

---

### Handoff instructions (how to use this doc)
- **Assign owners** to each milestone.
- **Set dates** (start with a 2-week sprint for Milestones 0–3, then add 4–7).
- **Require deliverables** (files/reports) before calling a milestone “done”.
- When agents propose changes to scope or data collection, they must reference the guardrails in `REDDIT_STRATEGY.md`.


