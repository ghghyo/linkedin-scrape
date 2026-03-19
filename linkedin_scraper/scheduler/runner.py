"""
Daily pipeline runner.

Orchestrates the full collection cycle:
1. db-migrate (ensure schema is up to date)
2. For each configured query (priority queries first):
   a. Scrape search results
   b. Classify posts
   c. Upsert posts + authors
   d. For high-signal posts: expand comments
   e. Classify comments
   f. Upsert comments
   g. Update checkpoint
3. Export CSV report
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Optional

from linkedin_scraper import config
from linkedin_scraper.db.migrations import (
    finish_run,
    run_migrations,
    start_run,
    update_checkpoint,
    upsert_author,
    upsert_comment,
    upsert_post,
)
from linkedin_scraper.db.models import get_engine, get_session
from linkedin_scraper.processing.export import default_output_path, export_combined_csv, write_csv
from linkedin_scraper.processing.pain_points import classify_comment, classify_post
from linkedin_scraper.scraper.browser import LinkedInSession, ensure_logged_in
from linkedin_scraper.scraper.post import expand_post_and_comments
from linkedin_scraper.scraper.rate_limiter import between_queries_cooldown, page_cooldown
from linkedin_scraper.scraper.search import scrape_search_results

logger = logging.getLogger(__name__)

# Posts with this many comments or more get their comments expanded
MIN_COMMENTS_FOR_EXPANSION = int(5)


async def run_query(
    session_ctx: LinkedInSession,
    db_session,
    query_cfg: dict,
    max_pages: int,
    max_posts_to_expand: int,
) -> tuple[int, int]:
    """
    Run a single search query: scrape results, classify, store, expand comments.
    Returns (posts_found, comments_found).
    """
    query = query_cfg["query"]
    category = query_cfg["category"]
    label = query_cfg.get("label", category)

    logger.info("--- Query: [%s] %s ---", label, query)

    page = session_ctx.page
    posts_raw = await scrape_search_results(page, query, max_pages=max_pages)
    logger.info("Search returned %d posts", len(posts_raw))

    posts_stored = 0
    comments_stored = 0
    high_signal_posts = []

    for post_data in posts_raw:
        post_data["search_query"] = query
        classify_post(post_data)
        post_obj = upsert_post(db_session, post_data)
        db_session.commit()
        posts_stored += 1

        # Track author
        if post_data.get("author_profile_url"):
            upsert_author(
                db_session,
                post_data["author_profile_url"],
                post_data.get("author_name", ""),
                post_data.get("author_headline", ""),
            )
            db_session.commit()

        # Queue high-signal posts for comment expansion
        if post_data.get("comments_count", 0) >= MIN_COMMENTS_FOR_EXPANSION:
            high_signal_posts.append(post_obj)

    logger.info(
        "Stored %d posts. %d qualify for comment expansion.",
        posts_stored,
        len(high_signal_posts),
    )

    # Expand comments for top N high-signal posts
    expand_targets = high_signal_posts[:max_posts_to_expand]
    for post_obj in expand_targets:
        if not post_obj.post_url:
            continue
        try:
            await page_cooldown()
            result = await expand_post_and_comments(page, post_obj.post_url)

            # Update post text if more complete version was extracted
            if result["post"].get("post_text"):
                post_obj.post_text = result["post"]["post_text"]

            for comment_data in result["comments"]:
                comment_data["post_id"] = post_obj.id
                classify_comment(comment_data)
                upsert_comment(db_session, comment_data)
                comments_stored += 1

                if comment_data.get("author_profile_url"):
                    upsert_author(
                        db_session,
                        comment_data["author_profile_url"],
                        comment_data.get("author_name", ""),
                        comment_data.get("author_headline", ""),
                    )

            db_session.commit()
            logger.info("Expanded comments for post: %s (%d comments)", post_obj.post_url, len(result["comments"]))

        except Exception as exc:
            logger.error("Error expanding post %s: %s", post_obj.post_url, exc)
            db_session.rollback()

    # Update checkpoint
    last_url = posts_raw[-1]["post_url"] if posts_raw else ""
    update_checkpoint(db_session, query, last_url, max_pages)
    db_session.commit()

    return posts_stored, comments_stored


async def run_daily_pipeline(
    queries: Optional[list[dict]] = None,
    max_pages: Optional[int] = None,
    max_posts_to_expand: Optional[int] = None,
    export_csv: bool = True,
) -> dict:
    """
    Full daily pipeline: migrate → login check → scrape all queries → export CSV.

    Args:
        queries: Override the query list (default: ALL_QUERIES).
        max_pages: Override MAX_PAGES_PER_QUERY.
        max_posts_to_expand: Override MAX_POSTS_TO_EXPAND.
        export_csv: Whether to write a CSV report after scraping.

    Returns summary dict with counts.
    """
    from linkedin_scraper.config import ALL_QUERIES, PRIORITY_QUERIES

    if queries is None:
        # Run priority queries first, then the rest
        priority_ids = {q["query"] for q in PRIORITY_QUERIES}
        rest = [q for q in ALL_QUERIES if q["query"] not in priority_ids]
        queries = PRIORITY_QUERIES + rest

    if max_pages is None:
        max_pages = config.MAX_PAGES_PER_QUERY
    if max_posts_to_expand is None:
        max_posts_to_expand = config.MAX_POSTS_TO_EXPAND

    # Ensure DB schema exists
    run_migrations(config.DB_PATH)
    engine = get_engine(config.DB_PATH)
    db_session = get_session(engine)

    total_posts = 0
    total_comments = 0
    runs = []

    async with LinkedInSession() as session_ctx:
        logged_in = await ensure_logged_in(session_ctx.page)
        if not logged_in:
            logger.error("Cannot proceed without a valid LinkedIn session. Aborting.")
            return {"status": "aborted", "reason": "not_logged_in"}

        for i, query_cfg in enumerate(queries):
            run = start_run(db_session, query_cfg["query"])
            posts_found = 0
            comments_found = 0
            error = None

            try:
                posts_found, comments_found = await run_query(
                    session_ctx, db_session, query_cfg, max_pages, max_posts_to_expand
                )
                total_posts += posts_found
                total_comments += comments_found
            except Exception as exc:
                logger.error("Query '%s' failed: %s", query_cfg["query"], exc)
                error = str(exc)

            finish_run(db_session, run, posts_found, comments_found, error)
            runs.append(run)

            # Cooldown between queries (skip after the last one)
            if i < len(queries) - 1:
                await between_queries_cooldown()

    # Export CSV report
    csv_path = None
    if export_csv:
        rows = export_combined_csv(db_session, since_days=1)
        if rows:
            csv_path = write_csv(rows, default_output_path())
            logger.info("CSV report written: %s", csv_path)
        else:
            logger.info("No new data to export today.")

    db_session.close()

    return {
        "status": "completed",
        "queries_run": len(queries),
        "total_posts": total_posts,
        "total_comments": total_comments,
        "csv_path": csv_path,
    }
