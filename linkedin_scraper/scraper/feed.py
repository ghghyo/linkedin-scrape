"""
Personal feed scraper.

Navigates directly to https://www.linkedin.com/feed/ (the user's personal
LinkedIn home feed) and scrolls through it, extracting posts.

Unlike search.py which queries specific keywords, this scrapes whatever
LinkedIn shows in the user's personalised feed — useful for monitoring
the user's own network and connections.

Posts stored with search_query="__personal_feed__" for easy filtering.
"""

from __future__ import annotations

import logging
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
    READY_SELECTORS,
    extract_post_card,
)

logger = logging.getLogger(__name__)

FEED_URL = "https://www.linkedin.com/feed/"
FEED_SOURCE_LABEL = "__personal_feed__"


async def scrape_personal_feed(
    page: Page,
    max_scrolls: int = 5,
    expand_comments: bool = False,
    max_posts_to_expand: int = None,
) -> list[dict]:
    """
    Navigate to the user's LinkedIn personal feed and extract visible posts.

    Args:
        page: Playwright Page (must already be logged in).
        max_scrolls: How many scroll batches to perform. Each batch scrolls
            to the bottom of currently loaded content and extracts new posts.
            More scrolls = more posts but higher detection risk.
            Recommended range: 3–8.
        expand_comments: If True, navigate into each post and extract commenters.
        max_posts_to_expand: Cap on comment expansion (default: MAX_POSTS_TO_EXPAND).

    Returns:
        List of post dicts, each tagged with search_query="__personal_feed__".
        If expand_comments=True, each dict also has a "comments" key.
    """
    from linkedin_scraper.scraper.post import expand_post_and_comments

    if max_posts_to_expand is None:
        max_posts_to_expand = config.MAX_POSTS_TO_EXPAND

    logger.info("Navigating to personal feed: %s", FEED_URL)
    await page.goto(FEED_URL, wait_until="domcontentloaded", timeout=30_000)

    # LinkedIn's home feed is JS-rendered; wait for at least one post container
    # to appear before we start scrolling and extracting.
    _waited = False
    for _sel in READY_SELECTORS:
        try:
            await page.wait_for_selector(_sel, timeout=10_000)
            logger.debug("Feed ready — posts detected via selector: %s", _sel)
            _waited = True
            break
        except Exception:
            continue
    if not _waited:
        logger.debug("wait_for_selector timed-out for all ready selectors on feed; will still try extraction")

    await action_delay()

    if await check_for_challenge(page):
        resolved = await wait_for_challenge_resolution(page)
        if not resolved:
            return []

    all_posts: list[dict] = []
    seen_urls: set[str] = set()

    for scroll_num in range(1, max_scrolls + 1):
        logger.info("Feed scroll batch %d/%d", scroll_num, max_scrolls)

        await scroll_to_bottom_gradually(page, max_scrolls=6)
        await short_delay()
        await move_mouse_randomly(page)

        batch_new = 0
        for selector in POST_CONTAINER_SELECTORS:
            locator = page.locator(selector)
            count = await locator.count()
            if count == 0:
                continue

            logger.debug("Found %d feed elements (selector: %s)", count, selector)

            for i in range(count):
                el = locator.nth(i)
                try:
                    # Pass page so SDUI posts can look up their activity URN
                    post = await extract_post_card(el, FEED_SOURCE_LABEL, FEED_URL, page=page)
                    if post and post.get("post_url") and post["post_url"] not in seen_urls:
                        seen_urls.add(post["post_url"])
                        all_posts.append(post)
                        batch_new += 1
                except Exception as exc:
                    logger.debug("Error extracting feed post %d: %s", i, exc)

            if batch_new > 0:
                break  # Use the first selector that yielded new results

        logger.info("Feed batch %d: %d new posts (total: %d)", scroll_num, batch_new, len(all_posts))

        if await check_for_challenge(page):
            resolved = await wait_for_challenge_resolution(page)
            if not resolved:
                break

        if scroll_num < max_scrolls:
            await action_delay()

    logger.info("Personal feed scrape complete: %d posts", len(all_posts))

    # ------------------------------------------------------------------
    # Optional comment expansion — only attempt for posts with real URLs
    # (synthetic URLs point to no real page so skip those)
    # ------------------------------------------------------------------
    if expand_comments and all_posts:
        real_url_posts = [
            p for p in all_posts
            if p.get("post_url") and "post-ref" not in p["post_url"]
        ]
        targets = sorted(
            real_url_posts,
            key=lambda p: p.get("comments_count", 0),
            reverse=True,
        )[:max_posts_to_expand]

        logger.info("Expanding comments for %d feed posts...", len(targets))

        for i, post in enumerate(targets):
            logger.info("  [%d/%d] Expanding: %s", i + 1, len(targets), post["post_url"])
            try:
                await page_cooldown()
                result = await expand_post_and_comments(page, post["post_url"])
                post["comments"] = result.get("comments", [])
                if result["post"].get("post_text"):
                    post["post_text"] = result["post"]["post_text"]
            except Exception as exc:
                logger.error("Error expanding feed post %s: %s", post["post_url"], exc)
                post["comments"] = []

    return all_posts
