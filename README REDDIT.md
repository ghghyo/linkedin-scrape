## TechNovaTime Reddit ingestion → CEO dashboard for Mimic

This repo implements a **minimal, compliant** ingestion + insight pipeline whose output is a **single CEO dashboard** for `mimic.technovatime.com`.

It follows `REDDIT_STRATEGY.md` (field minimization) and `REDDIT_EXECUTION_CHECKLIST.md` (milestones).

### Daily checklist (3 minutes total)

Open this:

1) **CEO dashboard**: `reports/metrics_dashboard.html`
   - Includes: top painpoints, who’s expressing them, where (subreddits), engagement targets, and a Mimic-aligned messaging/product playbook.
   - Also embeds the generated markdown reports (daily queue + weekly pain map), so you don’t need to open them separately.

If something looks off:
- newest `logs/daily_pipeline_*.log` and/or `logs/poll_new_*.log`

### Strategy note (important)

`REDDIT_STRATEGY.md` currently specifies ingesting via Reddit’s **public `*.json` endpoints** (best-effort), with robust backoff/logging and a readiness to fall back to OAuth later if needed.

### Quickstart (Windows / PowerShell)

1) Create your local `.env` (or set env vars) with at least:

```bash
REDDIT_USER_AGENT="TechNovaTimeMimic/0.1 (contact: you@example.com)"
DB_PATH="data/reddit.db"
```

Optional:
- `SUBREDDITS` is used by some CLI commands, but the scheduled scripts define their own subreddit lists (see below).

2) Install:

```bash
python -m pip install -U pip
python -m pip install -r requirements.txt
python -m pip install -e .
```

3) Initialize DB:

```bash
python -m technovatime_reddit.cli db-migrate
```

4) Run the fetch test (Milestone 0 DoD):

```bash
python -m technovatime_reddit.cli fetch-test --limit 25 --store
```

5) Ingest listing feeds (Milestone 1):

```bash
python -m technovatime_reddit.cli ingest-posts --feed new --limit 100 --max-pages 3 --store
python -m technovatime_reddit.cli ingest-posts --feed hot --limit 100 --max-pages 3 --store
python -m technovatime_reddit.cli ingest-posts --feed top --time-filter day --limit 100 --max-pages 3 --store
```

### “No new commands” scheduled workflow (recommended)

Task Scheduler should keep calling the same scripts/commands you already use:
- **Poll new**: `scripts/run_new_poll.ps1`
- **Daily pipeline**: `scripts/run_daily_pipeline.ps1`

Those scripts:
- run `db-migrate` automatically
- ingest posts across the configured subreddit list
- harvest high-signal threads/comments
- regenerate:
  - `daily_insights.json`
  - `reports/daily_engagement_queue.md`
  - `reports/weekly_pain_map.md`
  - `reports/metrics_dashboard.html` (CEO dashboard)

### What’s editable / tweakable (important)

- **CEO messaging + action playbook**: `ceo_playbook.json`
  - theme → why it matters, product moves, engagement scripts, safe CTA variants
- **Subreddits ingested**:
  - `scripts/run_new_poll.ps1` (near real-time `/new`)
  - `scripts/run_daily_pipeline.ps1` (daily `/hot` + `/top`)
  - Note: some subreddits can return 403 on `*.json` endpoints; remove/replace them if they fail.
- **Thread harvest heuristic** (how many comment threads are fetched daily):
  - `scripts/run_daily_pipeline.ps1` parameters: `ThreadsSinceHours`, `ThreadsMinComments`, `ThreadsMaxPosts`
- **DB location**: `DB_PATH` env var (default `data/reddit.db`)

### Compliance / guardrails
- **No automation that posts/comments** (this repo only reads + stores).
- **Data minimization**: schema stores only fields listed in `REDDIT_STRATEGY.md` plus operational/audit fields.

### Where things live
- **Config**: `.env` (local only) or env vars
- **Migrations**: `migrations/`
- **DB**: `data/reddit.db` (default)
- **CLI**: `python -m technovatime_reddit.cli ...`
- **Runbooks (Milestones 0–3)**: `docs/scheduler_runbook.md`, `docs/comment_scrape_policy.md`, `docs/EXECUTION_PLAN_M0_M3.md`

### ClickUp integration (daily action task)

This repo can automatically create/update **exactly one ClickUp task per day** after the dashboard is generated.

#### Required secrets / IDs (env vars)

Set these as environment variables (recommended via a local `.env`, which is gitignored):

- `CLICKUP_API_TOKEN`: ClickUp personal API token (Settings → Apps → API Token)
- `CLICKUP_LIST_ID`: the target ClickUp **List** where daily tasks should be created

Optional (only needed for discovery convenience):
- `CLICKUP_TEAM_ID`: ClickUp team/workspace id
- `CLICKUP_SPACE_ID`: space id
- `CLICKUP_FOLDER_ID`: folder id

#### Discover IDs (no hardcoding)

Once `CLICKUP_API_TOKEN` is set, you can list teams/spaces/lists:

```bash
python -m technovatime_reddit.cli clickup-discover
python -m technovatime_reddit.cli clickup-discover --space-id <SPACE_ID>
python -m technovatime_reddit.cli clickup-discover --space-id <SPACE_ID> --folder-id <FOLDER_ID>
```

#### Smoke test (required)

This confirms we can:
- list teams/spaces, and
- create a task in your target list.

```bash
python -m technovatime_reddit.cli clickup-smoke-test --list-id <LIST_ID>
```

#### Daily automation behavior

When the daily pipeline runs:

- `python -m technovatime_reddit.cli generate-metrics-dashboard ...`
  - updates `reports/metrics_dashboard.html`
  - also writes a structured artifact: `reports/daily_clickup_payload.json`
- then (if `CLICKUP_API_TOKEN` + `CLICKUP_LIST_ID` + `CLICKUP_REDDIT_VIEW_ID` are set) it runs:
  - `python -m technovatime_reddit.cli sync-clickup-reddit-view --payload reports/daily_clickup_payload.json`

Idempotency:
- The Embed View is renamed daily to **`Reddit view M/D`** (example: `Reddit view 1/13`)
- The daily instruction task title is **`Reddit Review — YYYY-MM-DD`**
- Re-running the pipeline the same day **updates the existing review task** (no duplicates).

#### ClickUp Embed View setup

You provided a ClickUp Embed View URL like:

- `https://app.clickup.com/9013614184/v/e/8cm1nk8-3233`

Set:
- `CLICKUP_REDDIT_VIEW_ID=8cm1nk8-3233`

The daily sync will upload `reports/metrics_dashboard.html` to a stable “host” task (created automatically) and then (best-effort) update the Embed View to point at the latest uploaded attachment URL.


