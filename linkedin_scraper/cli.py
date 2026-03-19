"""
LinkedIn Scraper CLI.

Usage:
    python -m linkedin_scraper.cli <command> [options]
    OR (if installed via pip install -e .):
    linkedin-scraper <command> [options]

Commands:
    db-migrate         Create / update database schema
    login              Interactive one-time login (saves persistent session)
    scrape-search      Scrape LinkedIn search results for a single query
    scrape-comments    Expand comments for high-signal posts in the DB
    export-csv         Export pain point findings to CSV
    clickup-discover   List ClickUp teams/spaces/lists to find your list ID
    clickup-smoke-test Verify ClickUp API access and create a test task
    clickup-push       Push reviewed findings to ClickUp (dedup-safe)
    run-daily          Run the full daily pipeline
    status             Show DB statistics and last run info
"""

from __future__ import annotations

import asyncio
import logging
import sys
from pathlib import Path

import click
from rich.console import Console
from rich.table import Table

from linkedin_scraper import config
from linkedin_scraper.db.migrations import run_migrations
from linkedin_scraper.db.models import (
    LinkedInComment,
    LinkedInPost,
    ScrapeCheckpoint,
    ScrapeRun,
    get_engine,
    get_session,
)

import io as _io
console = Console(
    file=_io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    if hasattr(sys.stdout, "buffer")
    else sys.stdout
)


def _setup_logging(level: str = "INFO") -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )


# ---------------------------------------------------------------------------
# CLI group
# ---------------------------------------------------------------------------

@click.group()
@click.option("--log-level", default=config.LOG_LEVEL, show_default=True,
              type=click.Choice(["DEBUG", "INFO", "WARNING", "ERROR"], case_sensitive=False),
              help="Logging verbosity.")
def cli(log_level: str) -> None:
    """LinkedIn Pain Point Scraper — collect leads from healthcare LinkedIn discussions."""
    _setup_logging(log_level)


# ---------------------------------------------------------------------------
# db-migrate
# ---------------------------------------------------------------------------

@cli.command("db-migrate")
def cmd_db_migrate() -> None:
    """Create or update the SQLite database schema."""
    console.print(f"[bold]Running migrations on:[/bold] {config.DB_PATH}")
    run_migrations(config.DB_PATH)
    console.print("[green]✓ Database schema up to date.[/green]")


# ---------------------------------------------------------------------------
# login
# ---------------------------------------------------------------------------

@cli.command("login")
def cmd_login() -> None:
    """
    Open a browser for one-time LinkedIn login.
    Session is saved persistently so future runs don't need to log in again.
    Automatically sets HEADLESS=false for this command.
    """
    import os
    os.environ["HEADLESS"] = "false"

    # Re-import config to pick up the env override
    import importlib
    import linkedin_scraper.config as cfg
    importlib.reload(cfg)

    async def _login():
        from playwright.async_api import async_playwright
        from linkedin_scraper.scraper.browser import ensure_logged_in, get_browser_context

        console.print("[bold]Opening browser for LinkedIn login...[/bold]")
        console.print("Please log in manually. The script will detect when you're done.")

        async with async_playwright() as p:
            context = await get_browser_context(p)
            page = await context.new_page()
            success = await ensure_logged_in(page)
            await context.close()

        if success:
            console.print("[green]✓ Login successful. Session saved.[/green]")
            console.print(f"Session stored in: [cyan]{config.SESSION_DIR}[/cyan]")
        else:
            console.print("[red]✗ Login failed or timed out.[/red]")
            sys.exit(1)

    asyncio.run(_login())


# ---------------------------------------------------------------------------
# scrape-search
# ---------------------------------------------------------------------------

@cli.command("scrape-search")
@click.option("--query", "-q", required=True, help="Search query string (use quotes for phrases).")
@click.option("--max-pages", default=config.MAX_PAGES_PER_QUERY, show_default=True, type=int,
              help="Number of scroll batches.")
@click.option("--no-industry-filter", is_flag=True, default=False,
              help="Disable healthcare industry code filter.")
@click.option("--category", default=None,
              help="Label this query with a pain point category (for the DB).")
@click.option(
    "--content-type",
    default="posts",
    show_default=True,
    type=click.Choice(["posts", "jobs", "all"], case_sensitive=False),
    help=(
        "LinkedIn content type filter. "
        "'posts' = general posts/comments, "
        "'jobs' = job postings (contentType=[\"jobs\"]), "
        "'all' = no content-type filter."
    ),
)
def cmd_scrape_search(query: str, max_pages: int, no_industry_filter: bool, category: str,
                      content_type: str) -> None:
    """Scrape LinkedIn search results for a single query and store in DB.

    Examples:

      General posts (default):
        python -m linkedin_scraper.cli scrape-search --query "Denials management"

      Job postings only:
        python -m linkedin_scraper.cli scrape-search --query "Denials management" --content-type jobs

      All content types:
        python -m linkedin_scraper.cli scrape-search --query "prior authorization" --content-type all
    """
    run_migrations(config.DB_PATH)
    engine = get_engine(config.DB_PATH)
    db_session = get_session(engine)

    # Normalise: CLI "all" maps to None (no filter) in the URL builder
    effective_content_type = None if content_type == "all" else content_type

    async def _run():
        from linkedin_scraper.db.migrations import (
            finish_run, start_run, update_checkpoint, upsert_author, upsert_post,
        )
        from linkedin_scraper.processing.pain_points import classify_post
        from linkedin_scraper.scraper.browser import LinkedInSession, ensure_logged_in
        from linkedin_scraper.scraper.search import scrape_search_results

        run = start_run(db_session, query)

        async with LinkedInSession() as s:
            logged_in = await ensure_logged_in(s.page)
            if not logged_in:
                console.print("[red]Not logged in. Run 'login' command first.[/red]")
                finish_run(db_session, run, 0, 0, "not_logged_in")
                return

            industries = None if no_industry_filter else config.HEALTHCARE_INDUSTRY_CODES
            posts_raw = await scrape_search_results(
                s.page, query, max_pages=max_pages,
                industries=industries,
                content_type=effective_content_type,
            )

        posts_stored = 0
        for post_data in posts_raw:
            post_data["search_query"] = query
            if category:
                post_data["pain_point_category"] = category
            else:
                classify_post(post_data)
            upsert_post(db_session, post_data)
            if post_data.get("author_profile_url"):
                upsert_author(db_session, post_data["author_profile_url"],
                              post_data.get("author_name", ""), post_data.get("author_headline", ""))
            posts_stored += 1

        last_url = posts_raw[-1]["post_url"] if posts_raw else ""
        update_checkpoint(db_session, query, last_url, max_pages)
        db_session.commit()
        finish_run(db_session, run, posts_stored, 0)

        console.print(
            f"[green]✓ Scraped {posts_stored} posts[/green] "
            f"(content-type=[cyan]{content_type}[/cyan]) for query: {query}"
        )

    asyncio.run(_run())


# ---------------------------------------------------------------------------
# scrape-comments
# ---------------------------------------------------------------------------

@cli.command("scrape-comments")
@click.option("--since", default="24h", show_default=True,
              help="Only expand posts scraped within this window (e.g. 24h, 7d).")
@click.option("--min-comments", default=5, show_default=True, type=int,
              help="Only expand posts with at least this many comments.")
@click.option("--limit", default=config.MAX_POSTS_TO_EXPAND, show_default=True, type=int,
              help="Maximum number of posts to expand.")
def cmd_scrape_comments(since: str, min_comments: int, limit: int) -> None:
    """Expand comments for high-signal posts already stored in the database."""
    run_migrations(config.DB_PATH)
    engine = get_engine(config.DB_PATH)
    db_session = get_session(engine)

    # Parse --since (e.g. "24h" -> 1 day, "7d" -> 7 days)
    since_days = _parse_since(since)

    async def _run():
        from linkedin_scraper.db.migrations import upsert_author, upsert_comment
        from linkedin_scraper.processing.pain_points import classify_comment
        from linkedin_scraper.scraper.browser import LinkedInSession, ensure_logged_in
        from linkedin_scraper.scraper.post import expand_post_and_comments
        from linkedin_scraper.scraper.rate_limiter import page_cooldown

        from datetime import datetime, timedelta, timezone
        cutoff = (datetime.now(timezone.utc) - timedelta(days=since_days)).isoformat()

        posts = (
            db_session.query(LinkedInPost)
            .filter(LinkedInPost.scraped_at >= cutoff)
            .filter(LinkedInPost.comments_count >= min_comments)
            .order_by(LinkedInPost.comments_count.desc())
            .limit(limit)
            .all()
        )

        if not posts:
            console.print("[yellow]No qualifying posts found.[/yellow]")
            return

        console.print(f"[bold]Expanding comments for {len(posts)} posts...[/bold]")
        total_comments = 0

        async with LinkedInSession() as s:
            logged_in = await ensure_logged_in(s.page)
            if not logged_in:
                console.print("[red]Not logged in. Run 'login' command first.[/red]")
                return

            for i, post in enumerate(posts):
                if not post.post_url:
                    continue
                console.print(f"  [{i+1}/{len(posts)}] {post.post_url}")
                try:
                    await page_cooldown()
                    result = await expand_post_and_comments(s.page, post.post_url)

                    for comment_data in result["comments"]:
                        comment_data["post_id"] = post.id
                        classify_comment(comment_data)
                        upsert_comment(db_session, comment_data)
                        total_comments += 1
                        if comment_data.get("author_profile_url"):
                            upsert_author(db_session, comment_data["author_profile_url"],
                                          comment_data.get("author_name", ""),
                                          comment_data.get("author_headline", ""))
                    db_session.commit()
                except Exception as exc:
                    console.print(f"  [red]Error: {exc}[/red]")
                    db_session.rollback()

        console.print(f"[green]✓ Extracted {total_comments} comments from {len(posts)} posts.[/green]")

    asyncio.run(_run())


# ---------------------------------------------------------------------------
# export-csv
# ---------------------------------------------------------------------------

@cli.command("export-csv")
@click.option("--since", default="7d", show_default=True,
              help="Export data from the last N days (e.g. 7d, 30d, all).")
@click.option("--category", default=None,
              help="Filter by pain point category key.")
@click.option("--reviewed-only", is_flag=True, default=False,
              help="Only export rows where is_relevant=True.")
@click.option("--executive-only", is_flag=True, default=False,
              help="Only export comments flagged as executive (is_executive=True).")
@click.option("--output", "-o", default=None,
              help="Output CSV file path. Defaults to reports/linkedin_pain_points_<timestamp>.csv")
@click.option("--min-score", default=0.0, show_default=True, type=float,
              help="Minimum pain_point_score for post rows (0.0-1.0).")
def cmd_export_csv(since: str, category: str, reviewed_only: bool, executive_only: bool,
                   output: str, min_score: float) -> None:
    """Export pain point findings to a CSV file for human review."""
    run_migrations(config.DB_PATH)
    engine = get_engine(config.DB_PATH)
    db_session = get_session(engine)

    from linkedin_scraper.processing.export import (
        default_output_path, export_combined_csv, write_csv,
    )

    since_days = None if since.lower() == "all" else _parse_since(since)
    output_path = output or default_output_path()

    rows = export_combined_csv(
        db_session,
        since_days=since_days,
        category=category,
        reviewed_only=reviewed_only,
        executive_only=executive_only,
        min_score=min_score,
    )

    if not rows:
        console.print("[yellow]No data matched the filters.[/yellow]")
        return

    csv_path = write_csv(rows, output_path)
    console.print(f"[green]✓ Exported {len(rows)} rows to:[/green] [cyan]{csv_path}[/cyan]")


# ---------------------------------------------------------------------------
# clickup-discover
# ---------------------------------------------------------------------------

@cli.command("clickup-discover")
@click.option("--space-id", default=config.CLICKUP_SPACE_ID or None,
              help="Space ID to list folders within.")
@click.option("--folder-id", default=config.CLICKUP_FOLDER_ID or None,
              help="Folder ID to list lists within.")
def cmd_clickup_discover(space_id: str, folder_id: str) -> None:
    """List ClickUp teams, spaces, and lists to find the target list ID."""
    if not config.CLICKUP_API_TOKEN:
        console.print("[red]CLICKUP_API_TOKEN not set in .env[/red]")
        sys.exit(1)

    async def _run():
        from linkedin_scraper.integrations.clickup import (
            list_folders, list_lists, list_spaces, list_teams,
        )

        teams = await list_teams(config.CLICKUP_API_TOKEN)
        console.print(f"\n[bold]Teams ({len(teams)}):[/bold]")
        for t in teams:
            console.print(f"  {t['id']}  {t['name']}")

        if space_id:
            if folder_id:
                lists = await list_lists(config.CLICKUP_API_TOKEN, folder_id)
                console.print(f"\n[bold]Lists in folder {folder_id}:[/bold]")
                for lst in lists:
                    console.print(f"  {lst['id']}  {lst['name']}")
            else:
                folders = await list_folders(config.CLICKUP_API_TOKEN, space_id)
                console.print(f"\n[bold]Folders in space {space_id}:[/bold]")
                for f in folders:
                    console.print(f"  {f['id']}  {f['name']}")

    asyncio.run(_run())


# ---------------------------------------------------------------------------
# clickup-smoke-test
# ---------------------------------------------------------------------------

@cli.command("clickup-smoke-test")
@click.option("--list-id", default=config.CLICKUP_LIST_ID or None, required=True,
              help="ClickUp List ID to create the test task in.")
def cmd_clickup_smoke_test(list_id: str) -> None:
    """Verify ClickUp API token and list access."""
    if not config.CLICKUP_API_TOKEN:
        console.print("[red]CLICKUP_API_TOKEN not set in .env[/red]")
        sys.exit(1)

    async def _run():
        from linkedin_scraper.integrations.clickup import smoke_test
        ok = await smoke_test(config.CLICKUP_API_TOKEN, list_id)
        if ok:
            console.print("[green]✓ ClickUp smoke test passed.[/green]")
        else:
            console.print("[red]✗ ClickUp smoke test failed. Check logs.[/red]")
            sys.exit(1)

    asyncio.run(_run())


# ---------------------------------------------------------------------------
# clickup-push
# ---------------------------------------------------------------------------

@cli.command("clickup-push")
@click.option("--list-id", default=config.CLICKUP_LIST_ID or None,
              help="Target ClickUp List ID (overrides CLICKUP_LIST_ID env var).")
@click.option("--reviewed-only", is_flag=True, default=True, show_default=True,
              help="Only push rows where is_relevant=True.")
@click.option("--executive-only", is_flag=True, default=False,
              help="Only push comments flagged as executive.")
def cmd_clickup_push(list_id: str, reviewed_only: bool, executive_only: bool) -> None:
    """Push reviewed pain point findings to ClickUp as tasks."""
    effective_list_id = list_id or config.CLICKUP_LIST_ID
    if not effective_list_id:
        console.print("[red]No list ID provided. Set CLICKUP_LIST_ID in .env or use --list-id.[/red]")
        sys.exit(1)
    if not config.CLICKUP_API_TOKEN:
        console.print("[red]CLICKUP_API_TOKEN not set in .env[/red]")
        sys.exit(1)

    run_migrations(config.DB_PATH)
    engine = get_engine(config.DB_PATH)
    db_session = get_session(engine)

    async def _run():
        from linkedin_scraper.integrations.clickup import push_reviewed_findings
        result = await push_reviewed_findings(
            db_session, config.CLICKUP_API_TOKEN, effective_list_id, executive_only
        )
        console.print(
            f"[green]✓ Posts pushed: {result['posts_pushed']}, "
            f"Comments pushed: {result['comments_pushed']}, "
            f"Skipped (already pushed): {result['skipped']}[/green]"
        )

    asyncio.run(_run())


# ---------------------------------------------------------------------------
# scrape-company
# ---------------------------------------------------------------------------

@cli.command("scrape-company")
@click.option(
    "--url", "-u", required=True,
    help=(
        "LinkedIn company page URL. "
        "e.g. https://www.linkedin.com/company/some-company/"
    ),
)
@click.option("--max-pages", default=config.MAX_PAGES_PER_QUERY, show_default=True, type=int,
              help="Number of scroll batches on the Posts tab.")
@click.option("--expand-comments", is_flag=True, default=False,
              help="Also navigate into each post and extract all commenters.")
@click.option("--max-expand", default=config.MAX_POSTS_TO_EXPAND, show_default=True, type=int,
              help="Max posts to expand comments for (only applies with --expand-comments).")
def cmd_scrape_company(url: str, max_pages: int, expand_comments: bool, max_expand: int) -> None:
    """Scrape posts (and optionally comments) from a specific company's LinkedIn page.

    Navigate directly to the company's Posts tab by URL — no keyword search needed.

    Examples:

      Scrape posts only:
        python -m linkedin_scraper.cli scrape-company --url "https://www.linkedin.com/company/some-company/"

      Scrape posts AND expand commenters:
        python -m linkedin_scraper.cli scrape-company --url "https://www.linkedin.com/company/some-company/" --expand-comments
    """
    run_migrations(config.DB_PATH)
    engine = get_engine(config.DB_PATH)
    db_session = get_session(engine)

    async def _run():
        from linkedin_scraper.db.migrations import (
            finish_run, start_run, update_checkpoint, upsert_author, upsert_comment, upsert_post,
        )
        from linkedin_scraper.processing.pain_points import classify_comment, classify_post
        from linkedin_scraper.scraper.browser import LinkedInSession, ensure_logged_in
        from linkedin_scraper.scraper.company import scrape_company_posts

        run = start_run(db_session, url)

        async with LinkedInSession() as s:
            logged_in = await ensure_logged_in(s.page)
            if not logged_in:
                console.print("[red]Not logged in. Run 'login' command first.[/red]")
                finish_run(db_session, run, 0, 0, "not_logged_in")
                return

            posts_raw = await scrape_company_posts(
                s.page, url,
                max_pages=max_pages,
                expand_comments=expand_comments,
                max_posts_to_expand=max_expand,
            )

        posts_stored = 0
        comments_stored = 0

        for post_data in posts_raw:
            post_data["search_query"] = url
            classify_post(post_data)
            post_obj = upsert_post(db_session, post_data)
            if post_data.get("author_profile_url"):
                upsert_author(db_session, post_data["author_profile_url"],
                              post_data.get("author_name", ""), post_data.get("author_headline", ""))
            posts_stored += 1

            # Store comments if they were expanded
            for comment_data in post_data.get("comments", []):
                comment_data["post_id"] = post_obj.id
                classify_comment(comment_data)
                upsert_comment(db_session, comment_data)
                if comment_data.get("author_profile_url"):
                    upsert_author(db_session, comment_data["author_profile_url"],
                                  comment_data.get("author_name", ""),
                                  comment_data.get("author_headline", ""))
                comments_stored += 1

        update_checkpoint(db_session, url, "", max_pages)
        db_session.commit()
        finish_run(db_session, run, posts_stored, comments_stored)

        console.print(
            f"[green]✓ Company scrape complete.[/green] "
            f"Posts: [cyan]{posts_stored}[/cyan], Comments: [cyan]{comments_stored}[/cyan]"
        )
        console.print(f"  Source: [dim]{url}[/dim]")

    asyncio.run(_run())


# ---------------------------------------------------------------------------
# scrape-feed
# ---------------------------------------------------------------------------

@cli.command("scrape-feed")
@click.option("--max-scrolls", default=5, show_default=True, type=int,
              help="Number of scroll batches on the personal feed.")
@click.option("--expand-comments", is_flag=True, default=False,
              help="Also navigate into each post and extract all commenters.")
@click.option("--max-expand", default=config.MAX_POSTS_TO_EXPAND, show_default=True, type=int,
              help="Max posts to expand comments for (only with --expand-comments).")
def cmd_scrape_feed(max_scrolls: int, expand_comments: bool, max_expand: int) -> None:
    """Scrape posts from your personal LinkedIn home feed.

    Navigates directly to linkedin.com/feed/ as your logged-in user and
    extracts whatever LinkedIn shows in your personalised feed. Useful for
    monitoring your network's activity for pain point signals.

    Posts are stored with source label '__personal_feed__' for easy filtering.

    Examples:

      Quick feed check (5 scrolls, posts only):
        python -m linkedin_scraper.cli scrape-feed

      Deeper feed with comment extraction:
        python -m linkedin_scraper.cli scrape-feed --max-scrolls 8 --expand-comments

      Export feed results after running:
        python -m linkedin_scraper.cli export-csv --since 1d
    """
    run_migrations(config.DB_PATH)
    engine = get_engine(config.DB_PATH)
    db_session = get_session(engine)

    async def _run():
        from linkedin_scraper.db.migrations import (
            finish_run, start_run, upsert_author, upsert_comment, upsert_post,
        )
        from linkedin_scraper.processing.pain_points import classify_comment, classify_post
        from linkedin_scraper.scraper.browser import LinkedInSession, ensure_logged_in
        from linkedin_scraper.scraper.feed import FEED_SOURCE_LABEL, scrape_personal_feed

        run = start_run(db_session, FEED_SOURCE_LABEL)

        async with LinkedInSession() as s:
            logged_in = await ensure_logged_in(s.page)
            if not logged_in:
                console.print("[red]Not logged in. Run 'login' command first.[/red]")
                finish_run(db_session, run, 0, 0, "not_logged_in")
                return

            posts_raw = await scrape_personal_feed(
                s.page,
                max_scrolls=max_scrolls,
                expand_comments=expand_comments,
                max_posts_to_expand=max_expand,
            )

        posts_stored = 0
        comments_stored = 0

        for post_data in posts_raw:
            classify_post(post_data)
            post_obj = upsert_post(db_session, post_data)
            if post_data.get("author_profile_url"):
                upsert_author(db_session, post_data["author_profile_url"],
                              post_data.get("author_name", ""), post_data.get("author_headline", ""))
            posts_stored += 1

            for comment_data in post_data.get("comments", []):
                comment_data["post_id"] = post_obj.id
                classify_comment(comment_data)
                upsert_comment(db_session, comment_data)
                if comment_data.get("author_profile_url"):
                    upsert_author(db_session, comment_data["author_profile_url"],
                                  comment_data.get("author_name", ""),
                                  comment_data.get("author_headline", ""))
                comments_stored += 1

        db_session.commit()
        finish_run(db_session, run, posts_stored, comments_stored)

        console.print(
            f"[green]✓ Feed scrape complete.[/green] "
            f"Posts: [cyan]{posts_stored}[/cyan], Comments: [cyan]{comments_stored}[/cyan]"
        )

    asyncio.run(_run())


# ---------------------------------------------------------------------------
# run-daily
# ---------------------------------------------------------------------------

@cli.command("run-daily")
@click.option("--max-pages", default=config.MAX_PAGES_PER_QUERY, show_default=True, type=int)
@click.option("--max-expand", default=config.MAX_POSTS_TO_EXPAND, show_default=True, type=int,
              help="Max posts to expand comments for per query.")
@click.option("--no-csv", is_flag=True, default=False, help="Skip CSV export at end.")
@click.option("--priority-only", is_flag=True, default=False,
              help="Only run the gold mine / priority queries.")
def cmd_run_daily(max_pages: int, max_expand: int, no_csv: bool, priority_only: bool) -> None:
    """Run the full daily scraping pipeline."""
    from linkedin_scraper.config import ALL_QUERIES, PRIORITY_QUERIES
    from linkedin_scraper.scheduler.runner import run_daily_pipeline

    queries = PRIORITY_QUERIES if priority_only else None

    console.print("[bold]Starting daily LinkedIn pipeline...[/bold]")
    result = asyncio.run(
        run_daily_pipeline(
            queries=queries,
            max_pages=max_pages,
            max_posts_to_expand=max_expand,
            export_csv=not no_csv,
        )
    )

    status = result.get("status", "unknown")
    if status == "completed":
        console.print(
            f"[green]✓ Pipeline complete. "
            f"Posts: {result['total_posts']}, "
            f"Comments: {result['total_comments']}, "
            f"Queries: {result['queries_run']}[/green]"
        )
        if result.get("csv_path"):
            console.print(f"  CSV report: [cyan]{result['csv_path']}[/cyan]")
    else:
        console.print(f"[red]Pipeline ended with status: {status}[/red]")
        sys.exit(1)


# ---------------------------------------------------------------------------
# status
# ---------------------------------------------------------------------------

@cli.command("status")
def cmd_status() -> None:
    """Show database statistics and recent run info."""
    run_migrations(config.DB_PATH)
    engine = get_engine(config.DB_PATH)
    db_session = get_session(engine)

    post_count = db_session.query(LinkedInPost).count()
    comment_count = db_session.query(LinkedInComment).count()
    reviewed_posts = db_session.query(LinkedInPost).filter_by(is_relevant=True).count()
    reviewed_comments = db_session.query(LinkedInComment).filter_by(is_relevant=True).count()
    exec_comments = db_session.query(LinkedInComment).filter_by(is_executive=True).count()
    pushed = db_session.query(LinkedInPost).count()  # reuse model import

    from linkedin_scraper.db.models import ClickUpTask
    pushed_count = db_session.query(ClickUpTask).count()

    console.print("\n[bold]Database Summary[/bold]")
    tbl = Table(show_header=True, header_style="bold magenta")
    tbl.add_column("Metric")
    tbl.add_column("Count", justify="right")
    tbl.add_row("Total posts", str(post_count))
    tbl.add_row("Total comments", str(comment_count))
    tbl.add_row("Reviewed posts (is_relevant=True)", str(reviewed_posts))
    tbl.add_row("Reviewed comments (is_relevant=True)", str(reviewed_comments))
    tbl.add_row("Executive commenters", str(exec_comments))
    tbl.add_row("Tasks pushed to ClickUp", str(pushed_count))
    console.print(tbl)

    # Recent runs
    recent_runs = (
        db_session.query(ScrapeRun)
        .order_by(ScrapeRun.started_at.desc())
        .limit(5)
        .all()
    )
    if recent_runs:
        console.print("\n[bold]Last 5 Scrape Runs[/bold]")
        run_tbl = Table(show_header=True, header_style="bold cyan")
        run_tbl.add_column("ID")
        run_tbl.add_column("Started")
        run_tbl.add_column("Query")
        run_tbl.add_column("Posts")
        run_tbl.add_column("Comments")
        run_tbl.add_column("Status")
        for r in recent_runs:
            run_tbl.add_row(
                str(r.id),
                (r.started_at or "")[:19],
                (r.search_query or "")[:40],
                str(r.posts_found),
                str(r.comments_found),
                r.status or "",
            )
        console.print(run_tbl)

    # Checkpoints
    checkpoints = db_session.query(ScrapeCheckpoint).all()
    if checkpoints:
        console.print("\n[bold]Scrape Checkpoints[/bold]")
        cp_tbl = Table(show_header=True, header_style="bold green")
        cp_tbl.add_column("Query")
        cp_tbl.add_column("Last Scraped")
        cp_tbl.add_column("Pages")
        for cp in checkpoints:
            cp_tbl.add_row(
                (cp.search_query or "")[:50],
                (cp.last_scraped_at or "")[:19],
                str(cp.pages_scraped),
            )
        console.print(cp_tbl)

    db_session.close()
    console.print()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse_since(since: str) -> int:
    """Parse a 'since' string like '24h', '7d', '30d' into days (int)."""
    since = since.strip().lower()
    if since.endswith("h"):
        return max(1, int(since[:-1]) // 24)
    if since.endswith("d"):
        return int(since[:-1])
    try:
        return int(since)
    except ValueError:
        return 7  # default


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    cli()
