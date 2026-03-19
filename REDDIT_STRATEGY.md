### Reddit ICP Scraping + Community Value Strategy (TechNovaTime / Mimic)

### Purpose
TechNovaTime will use **official Reddit API data** (public `*.json` endpoints) to:
- **Understand** recurring ICP pains, requests, and language
- **Engage** by providing consistently helpful posts/comments (community-first)
- **Convert** attention into trust and qualified traffic to `mimic.technovatime.com` (only when allowed by subreddit rules)

This strategy is designed to work alongside `REDDIT_EXECUTION_CHECKLIST.md` (the agent handoff plan).

---

### Non-negotiables (CEO guardrails)
- **Comply with Reddit ToS + each subreddit’s rules.**
- **Be transparent** when engaging: you’re building Mimic at TechNovaTime.
- **No spam**: prioritize high-signal threads and helpfulness over volume.
- **Data minimization**: store only what’s needed for analysis and engagement; avoid sensitive personal data.
- **No “dark patterns”**: no aggressive gating, popups, or misleading links.

---

### Tooling decision (scraping implementation)
We will ingest via Reddit’s **public `.json` endpoints** by appending **`.json`** to subreddit and post URLs.

- **Why**: no OAuth/app setup required; fast iteration; easy to operationalize.
- **Caveat**: treat this as **best-effort**. Public endpoints may rate-limit or change behavior. Build robust backoff + logging, and be ready to fall back to OAuth later if needed.

#### How the `.json` approach works (two-step crawl)
- **Step 1 (subreddit listing)**: fetch a listing feed to enumerate post permalinks:
  - `https://www.reddit.com/r/AgentsofAI/new.json`
  - `https://www.reddit.com/r/AI_Agents/new.json`
  - Also run daily snapshots:
    - `https://www.reddit.com/r/<sub>/hot.json`
    - `https://www.reddit.com/r/<sub>/top.json?t=day`
- **Step 2 (post thread)**: for each post `permalink` from Step 1, fetch the full thread:
  - `https://www.reddit.com<permalink>.json`
  - This returns an array where:
    - element `[0]` contains the post
    - element `[1]` contains the comment tree (plus “more” placeholders)

---

### Target communities (initial scope)
- **Primary subreddits**: `r/AgentsofAI`, `r/AI_Agents`
- **Expanded marketing scope (optional)**: founder/agency-owner communities like `r/Entrepreneur`, `r/SaaS`, `r/sidehustle`, `r/startups`, `r/automation`, `r/nocode`
  - Operational note: the live subreddit list is configured in `scripts/run_new_poll.ps1` and `scripts/run_daily_pipeline.ps1`.
- **Content focus**: agent workflows, tooling, evaluation, reliability, deployment, cost, monitoring, integrations, failure modes

---

### Data collection plan (what we scrape)
Collect **posts** and **comments** needed to understand themes and engagement patterns. Public JSON responses will be normalized into our analysis schema.

#### Post fields (minimum viable)
- **Identity**: `id`, `subreddit`, `permalink`, `created_utc`
- **Content**: `title`, `selftext`, `url`, `link_flair_text`
- **Signals**: `score`, `upvote_ratio`, `num_comments`, `is_self`
- **Author**: `author` (string only; don’t over-profile)

#### Comment fields (minimum viable)
- **Identity**: `id`, `post_id`, `parent_id`, `permalink`, `created_utc`
- **Content**: `body`
- **Signals**: `score`
- **Author**: `author` (string only; best-effort)

#### Operational fields (for reliability + auditing)
- `scraped_at`, `source_endpoint`, `api_response_version` (if applicable), `is_deleted` (best-effort)

---

### Scraping cadence (how often)
- **Near-real-time**: poll each subreddit’s `new.json` at **10–20 minute** intervals.
- **Daily**: capture `hot.json` and `top.json?t=day` snapshots.
- **Comment harvesting**: for new/high-signal posts, fetch `<permalink>.json` to capture post body + comment tree.
- **Historical scope**: start forward-only with stable incremental runs; expand later if rate limits allow.

---

### Insight pipeline (turn text into decisions)
We convert raw text into structured insights that can drive:
- content (posts/comments),
- product prioritization,
- positioning/messaging.

#### Core classification labels
- **Complaint / Pain**
- **Help request / “How do I…”**
- **Tooling comparison / migration**
- **Workflow / process**
- **Showcase / results**

#### Extraction fields (structured)
- **Theme** (e.g., “agent reliability”, “evals”, “tooling sprawl”, “latency/cost”, “deployment”, “prompt brittleness”)
- **Stage**: experimenting / prototyping / production
- **Stack mentions**: frameworks, models, vector DBs, observability tools (best-effort)
- **Desired outcome**: what success looks like in the user’s words

#### Prioritization (simple impact scoring)
Create an “Impact Score” to rank what to act on first:
\[
Impact = 0.5 \cdot \text{num\_comments} + 0.3 \cdot \text{score} + 0.2 \cdot \text{recency}
\]
(Weights are adjustable once we observe behavior.)

---

### CEO operating rhythm (how we use insights)

#### Weekly: ICP Pain Map
Produce a one-pager with:
- **Top 10 recurring complaints** (with anonymized quotes + thread links/permalinks)
- **Top 10 jobs-to-be-done**
- **Top blockers to shipping**
- **What’s praised** (signals for positioning)

#### Biweekly: decisions
- **Positioning**: pick 1–2 pains to “own”
- **Roadmap**: tie 1–2 product bets to top pains
- **Proof**: define measurable outcomes (reliability, cost, eval scores, time-to-first-value)

#### Monthly: public “state of the community”
Publish a summary based on aggregated themes:
- no doxxing,
- no targeted callouts,
- source threads when allowed and appropriate.

---

### Engagement strategy (community-first)

#### Commenting (highest ROI)
Target threads that match the Pain Map and respond with:
- **Diagnosis**: what’s likely going wrong
- **Concrete fix**: steps, not slogans
- **Free artifact**: template/checklist snippet
- **Soft CTA only if allowed**: point to `mimic.technovatime.com` as “more detail / free resource”

#### Posting (repeatable high-value formats)
Use “formats” that communities tend to reward:
- **Playbooks**: “How to evaluate agent reliability in 60 minutes”
- **Templates**: eval rubric, test suite outline, incident postmortem template
- **Benchmarks**: “3 ways to reduce tool-call costs without losing accuracy”
- **Case breakdowns**: anonymized “what worked / what failed”
- **Office hours**: monthly “drop your workflow; I’ll suggest instrumentation/evals”

#### Frequency (avoid spam)
- **Daily**: 1–3 high-quality comments (not mandatory if no good threads)
- **Weekly**: 1 strong value post (alternate subs as needed)

---

### Free value funnel to Mimic (conversion without being pushy)

#### Build 3 evergreen free resources
Host on `mimic.technovatime.com` with **no aggressive gating**:
- **Agent Evals Starter Kit** (rubric + 10 test prompts + scoring sheet)
- **Production Readiness Checklist** (retries, fallbacks, tracing, monitoring, evals)
- **Cost & Latency Calculator** (simple worksheet)

#### “Reddit-friendly” landing page
One page tailored to these subs:
- “Free tools/checklists mentioned on Reddit”
- fast load, clear structure, no popups
- brief “What is Mimic?” near the bottom

---

### Success metrics (so it stays business-driven)
- **Community**: comment upvotes, replies, “thanks”, DMs, repeat recognizers
- **Traffic**: visits to the Reddit-friendly page, time on page, resource downloads
- **Pipeline**: demos mentioning Reddit, conversions from resource users
- **Product**: improved time-to-first-value and reduced failure modes for the top pains

---

### Next step
Use `REDDIT_EXECUTION_CHECKLIST.md` to assign agents and ship the data pipeline + engagement workflow in parallel.


