"""
Post and comment extractor.

Navigates to an individual LinkedIn post page, expands the full text,
loads all visible comments, and extracts author + comment data.

Selector patterns are adapted from content.js.
"""

from __future__ import annotations

import logging
import re
import urllib.parse
from typing import Optional

from playwright.async_api import Page

from linkedin_scraper.scraper.rate_limiter import (
    action_delay,
    check_for_challenge,
    move_mouse_randomly,
    scroll_to_bottom_gradually,
    short_delay,
    smooth_scroll_down,
    wait_for_challenge_resolution,
)
from linkedin_scraper.scraper.search import (
    AUTHOR_HEADLINE_SELECTORS,
    AUTHOR_LINK_SELECTORS,
    AUTHOR_NAME_SELECTORS,
    _clean_profile_url,
    _first_attr,
    _first_text,
    _parse_engagement_number,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Comment-specific selectors
# ---------------------------------------------------------------------------

COMMENT_CONTAINER_SELECTORS = [
    ".comments-comment-item",
    ".comments-comment-item__content",
    "article.comments-comment-item",
    ".comments-comment-list .comments-comment-item",
]

COMMENT_TEXT_SELECTORS = [
    ".comments-comment-item__main-content",
    ".comments-comment-item__main-content span",
    ".update-components-text span",
    ".comments-comment-texteditor span",
    "span.comments-comment-item__main-content",
]

COMMENT_AUTHOR_NAME_SELECTORS = [
    ".comments-post-meta__name-text",
    ".comments-post-meta__name-text span[aria-hidden='true']",
    ".comments-post-meta__actor-link span[aria-hidden='true']",
    ".comments-comment-item__author-name",
]

COMMENT_AUTHOR_HEADLINE_SELECTORS = [
    ".comments-post-meta__headline",
    ".comments-post-meta__headline span",
    ".comments-comment-item__author-description",
]

COMMENT_AUTHOR_LINK_SELECTORS = [
    ".comments-post-meta__actor-link",
    "a.comments-post-meta__actor-link",
    ".comments-post-meta a[href*='/in/']",
]

COMMENT_REACTIONS_SELECTORS = [
    ".comments-comment-social-bar__reactions-count",
    "button[aria-label*='reaction'] span",
    ".comments-comment-social-bar button span",
]

LOAD_MORE_COMMENTS_SELECTORS = [
    "button.comments-comments-list__load-more-comments-button",
    "button[aria-label*='Load more comments']",
    ".comments-comments-list__load-more-comments-button",
]

SEE_MORE_TEXT_SELECTORS = [
    "button.feed-shared-inline-show-more-text__see-more-less-toggle",
    "button[aria-label='see more']",
    ".see-more",
    "span.see-more",
]

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_urn_from_url(url: str) -> str:
    """Extract LinkedIn activity URN from a feed update URL."""
    match = re.search(r"urn:li:activity:(\d+)", url)
    if match:
        return f"urn:li:activity:{match.group(1)}"
    return url


# ---------------------------------------------------------------------------
# Main extraction functions
# ---------------------------------------------------------------------------

async def _expand_post_text(page: Page) -> None:
    """Click 'see more' to expand truncated post text."""
    for selector in SEE_MORE_TEXT_SELECTORS:
        try:
            btn = page.locator(selector).first
            if await btn.count() > 0 and await btn.is_visible():
                await btn.click()
                await short_delay()
                return
        except Exception:
            continue


async def _load_all_comments(page: Page, max_loads: int = 5) -> None:
    """
    Click 'Load more comments' button up to `max_loads` times.
    Stops when the button disappears.
    """
    for i in range(max_loads):
        loaded = False
        for selector in LOAD_MORE_COMMENTS_SELECTORS:
            try:
                btn = page.locator(selector).first
                if await btn.count() > 0 and await btn.is_visible():
                    await btn.scroll_into_view_if_needed()
                    await short_delay()
                    await btn.click()
                    await action_delay()
                    loaded = True
                    logger.debug("Loaded more comments (click %d)", i + 1)
                    break
            except Exception:
                continue
        if not loaded:
            break


async def extract_comments_from_page(page: Page, post_id: str) -> list[dict]:
    """
    Extract all visible comments from the current post page.
    Returns a list of comment dicts.
    """
    comments: list[dict] = []
    seen_texts: set[str] = set()

    for selector in COMMENT_CONTAINER_SELECTORS:
        locator = page.locator(selector)
        count = await locator.count()
        if count == 0:
            continue

        logger.debug("Found %d comment elements with selector: %s", count, selector)

        for i in range(count):
            el = locator.nth(i)
            try:
                author_name = await _first_text(el, COMMENT_AUTHOR_NAME_SELECTORS)
                comment_text = await _first_text(el, COMMENT_TEXT_SELECTORS)

                if not comment_text or not author_name:
                    continue

                # Deduplicate by text content
                dedup_key = f"{author_name}|{comment_text[:80]}"
                if dedup_key in seen_texts:
                    continue
                seen_texts.add(dedup_key)

                author_headline = await _first_text(el, COMMENT_AUTHOR_HEADLINE_SELECTORS)
                author_profile_url = _clean_profile_url(
                    await _first_attr(el, COMMENT_AUTHOR_LINK_SELECTORS, "href")
                )
                reactions_raw = await _first_text(el, COMMENT_REACTIONS_SELECTORS)

                # Detect if this is a reply (nested comment)
                # LinkedIn reply containers typically have a different ARIA role or
                # a parent class indicating a thread
                is_reply = False
                try:
                    parent_html = await el.evaluate(
                        "el => el.closest('.comments-comment-item__nested-items') !== null"
                    )
                    is_reply = bool(parent_html)
                except Exception:
                    pass

                comments.append({
                    "post_id": post_id,
                    "author_name": author_name,
                    "author_headline": author_headline,
                    "author_profile_url": author_profile_url,
                    "comment_text": comment_text,
                    "reactions_count": _parse_engagement_number(reactions_raw),
                    "is_reply": is_reply,
                    "parent_comment_id": None,
                })
            except Exception as exc:
                logger.debug("Error extracting comment %d: %s", i, exc)

        # Use the first selector that yielded results
        if comments:
            break

    return comments


async def expand_post_and_comments(
    page: Page,
    post_url: str,
    max_comment_loads: int = 5,
) -> dict:
    """
    Navigate to a post URL, expand full text, load all comments,
    and return structured data for the post and its comments.

    Args:
        page: Playwright Page (must be logged in).
        post_url: Direct URL to the LinkedIn post.
        max_comment_loads: Max times to click 'Load more comments'.

    Returns:
        dict with keys:
            - post: updated post dict (post_text may be more complete than from search)
            - comments: list of comment dicts
    """
    logger.info("Expanding post: %s", post_url)
    await page.goto(post_url, wait_until="domcontentloaded", timeout=30_000)
    await action_delay()

    if await check_for_challenge(page):
        resolved = await wait_for_challenge_resolution(page)
        if not resolved:
            return {"post": {}, "comments": []}

    # Expand truncated post text
    await _expand_post_text(page)

    # Derive post ID from URL
    post_id_str = _extract_urn_from_url(post_url)

    # Scroll down to load the comments section
    await smooth_scroll_down(page, 600)
    await short_delay()

    # Load additional comment batches
    await _load_all_comments(page, max_loads=max_comment_loads)
    await move_mouse_randomly(page)

    # Extract full post text (more complete after expanding)
    post_text = ""
    post_text_selectors = [
        ".feed-shared-update-v2__description",
        ".feed-shared-text",
        ".break-words",
        ".update-components-text",
        ".update-components-update-v2__commentary",
    ]
    for sel in post_text_selectors:
        try:
            loc = page.locator(sel).first
            if await loc.count() > 0:
                post_text = (await loc.inner_text()).strip()
                if post_text:
                    break
        except Exception:
            continue

    # Extract comments
    comments = await extract_comments_from_page(page, post_id_str)
    logger.info("Extracted %d comments from %s", len(comments), post_url)

    return {
        "post": {
            "post_url": post_url,
            "post_text": post_text,
        },
        "comments": comments,
    }
