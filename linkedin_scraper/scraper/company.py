"""
Company page post scraper.

Navigates directly to a LinkedIn company page's Posts tab via its URL
(e.g. https://www.linkedin.com/company/some-company/) and extracts all
visible posts, optionally expanding their comment sections.

This is different from search.py: instead of using LinkedIn's search,
we navigate to the company's own page and collect posts from there.
"""

from __future__ import annotations

import logging
import re
from typing import Optional

from playwright.async_api import Page

from linkedin_scraper import config
from linkedin_scraper.scraper.rate_limiter import (
    action_delay,
    check_for_challenge,
    move_mouse_randomly,
    page_cooldown,
    scroll_to_bottom_gradually,
    short_delay,
    wait_for_challenge_resolution,
)
from linkedin_scraper.scraper.search import (
    POST_CONTAINER_SELECTORS,
    extract_post_card,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# URL helpers
# ---------------------------------------------------------------------------

def build_company_posts_url(company_url: str) -> str:
    """
    Derive the /posts/ tab URL from any form of a company URL.

    Handles:
        https://www.linkedin.com/company/some-company/
        https://www.linkedin.com/company/some-company
        https://www.linkedin.com/company/some-company/about/
    """
    # Strip trailing slashes and any sub-path after the slug
    url = company_url.rstrip("/")
    # Remove any trailing path segment that isn't just the company slug
    match = re.match(r"(https?://(?:www\.)?linkedin\.com/company/[^/]+)", url)
    if match:
        base = match.group(1)
    else:
        base = url

    return base.rstrip("/") + "/posts/"


# ---------------------------------------------------------------------------
# Post extraction (reuse search.py logic)
# ---------------------------------------------------------------------------

async def _extract_posts_from_page(page: Page, company_url: str) -> list[dict]:
    """
    Extract all visible post cards on the current company posts page.
    Tags each post with the company URL as its search_query for DB tracking.
    """
    posts: list[dict] = []

    for selector in POST_CONTAINER_SELECTORS:
        locator = page.locator(selector)
        count = await locator.count()
        if count == 0:
            continue

        logger.debug("Found %d post elements (selector: %s)", count, selector)

        for i in range(count):
            el = locator.nth(i)
            try:
                post = await extract_post_card(el, company_url, page.url, page=page)
                if post and post.get("post_url"):
                    posts.append(post)
            except Exception as exc:
                logger.debug("Error extracting company post card %d: %s", i, exc)

        if posts:
            break  # Use the first selector that yielded results

    return posts


# ---------------------------------------------------------------------------
# Main scraper
# ---------------------------------------------------------------------------

async def scrape_company_posts(
    page: Page,
    company_url: str,
    max_pages: int = None,
    expand_comments: bool = False,
    max_posts_to_expand: int = None,
) -> list[dict]:
    """
    Navigate to a LinkedIn company's Posts tab, scroll through, and extract posts.

    Args:
        page: Playwright Page (must already be logged in).
        company_url: Any form of the company's LinkedIn URL.
            e.g. https://www.linkedin.com/company/some-company/
        max_pages: Number of scroll batches to perform (default: MAX_PAGES_PER_QUERY).
        expand_comments: If True, also navigate into each post and extract commenters.
        max_posts_to_expand: Cap on comment expansions (default: MAX_POSTS_TO_EXPAND).

    Returns:
        List of post dicts. If expand_comments=True, each post dict will also have
        a "comments" key containing the list of comment dicts.
    """
    from linkedin_scraper.scraper.post import expand_post_and_comments

    if max_pages is None:
        max_pages = config.MAX_PAGES_PER_QUERY
    if max_posts_to_expand is None:
        max_posts_to_expand = config.MAX_POSTS_TO_EXPAND

    posts_url = build_company_posts_url(company_url)
    logger.info("Scraping company posts: %s", posts_url)

    await page.goto(posts_url, wait_until="domcontentloaded", timeout=30_000)
    await action_delay()

    if await check_for_challenge(page):
        resolved = await wait_for_challenge_resolution(page)
        if not resolved:
            return []

    all_posts: list[dict] = []
    seen_urls: set[str] = set()

    for page_num in range(1, max_pages + 1):
        logger.info("Company posts scroll batch %d/%d", page_num, max_pages)

        await scroll_to_bottom_gradually(page, max_scrolls=5)
        await short_delay()
        await move_mouse_randomly(page)

        batch = await _extract_posts_from_page(page, company_url)
        batch_new = 0
        for post in batch:
            url = post.get("post_url", "")
            if url and url not in seen_urls:
                seen_urls.add(url)
                all_posts.append(post)
                batch_new += 1

        logger.info("Batch %d: %d new posts (total: %d)", page_num, batch_new, len(all_posts))

        if await check_for_challenge(page):
            resolved = await wait_for_challenge_resolution(page)
            if not resolved:
                break

        if page_num < max_pages:
            await action_delay()

    logger.info("Company post scrape complete: %d posts from %s", len(all_posts), company_url)

    # ------------------------------------------------------------------
    # Optional comment expansion
    # ------------------------------------------------------------------
    if expand_comments and all_posts:
        targets = [p for p in all_posts if p.get("post_url")][:max_posts_to_expand]
        logger.info("Expanding comments for %d company posts...", len(targets))

        for i, post in enumerate(targets):
            logger.info("  [%d/%d] Expanding: %s", i + 1, len(targets), post["post_url"])
            try:
                await page_cooldown()
                result = await expand_post_and_comments(page, post["post_url"])
                post["comments"] = result.get("comments", [])
                # Update post text if the expanded version is more complete
                if result["post"].get("post_text"):
                    post["post_text"] = result["post"]["post_text"]
            except Exception as exc:
                logger.error("Error expanding company post %s: %s", post["post_url"], exc)
                post["comments"] = []

    return all_posts
