"""
LinkedIn search scraper.

Constructs search URLs, navigates to them, scrolls through results,
and extracts post metadata from each visible card.

Supports both LinkedIn DOM architectures:
  - Legacy Ember.js / classic feed: posts have data-urn / data-id attributes
  - New SDUI / RSC (2025-2026 redesign): posts use role="listitem" with
    componentkey attributes; class names are obfuscated hashes.
"""

from __future__ import annotations

import hashlib
import logging
import re
import urllib.parse
from typing import Any, Optional

from playwright.async_api import Page

from linkedin_scraper import config
from linkedin_scraper.scraper.rate_limiter import (
    action_delay,
    check_for_challenge,
    move_mouse_randomly,
    scroll_to_bottom_gradually,
    short_delay,
    wait_for_challenge_resolution,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Selectors
# ---------------------------------------------------------------------------

# Post container selectors — tried in order until one yields results.
# 1. New SDUI architecture (feed + search, 2025-2026): role="listitem" with
#    a componentkey that starts with "expanded" (regular post items).
# 2. Legacy Ember.js / company-page architecture: data-urn / data-id attrs.
POST_CONTAINER_SELECTORS = [
    # New SDUI architecture (feed & search results pages, 2025-2026)
    '[role="listitem"][componentkey^="expanded"]',
    # Scaffold finite-scroll layout fallback
    '.scaffold-finite-scroll__content [data-urn*="urn:li:activity"]',
    '.scaffold-finite-scroll__content > div > div[data-id]',
    # Classic / company-page architecture
    '[data-urn^="urn:li:activity"]',
    '[data-id^="urn:li:activity"]',
    'div[data-urn*="activity"]',
    'div.relative[data-urn]',
    # Legacy class-based fallbacks
    ".feed-shared-update-v2",
    ".occludable-update",
]

# Selector used to wait for the feed/search page to be ready
# (tried in order; first hit wins)
READY_SELECTORS = [
    '[role="listitem"][componentkey^="expanded"]',
    '[data-testid="mainFeed"]',
    '[data-urn^="urn:li:activity"]',
    '[data-id^="urn:li:activity"]',
    ".feed-shared-update-v2",
]

# ---- Old-architecture author / text / engagement selectors ----------------

AUTHOR_NAME_SELECTORS = [
    ".update-components-actor__name span[aria-hidden='true']",
    ".update-components-actor__name span.hoverable-link-text",
    ".feed-shared-actor__name span",
    ".update-components-actor__title span:first-child",
]

AUTHOR_HEADLINE_SELECTORS = [
    ".update-components-actor__description",
    ".update-components-actor__description span[aria-hidden='true']",
    ".feed-shared-actor__description",
    ".update-components-actor__subtitle",
]

AUTHOR_LINK_SELECTORS = [
    ".update-components-actor__container-link",
    ".update-components-actor__image a",
    ".feed-shared-actor__container-link",
    "a[data-control-name='actor']",
    "a.app-aware-link[href*='/in/']",
]

POST_TEXT_SELECTORS = [
    ".feed-shared-update-v2__description",
    ".feed-shared-text",
    ".break-words",
    ".update-components-text",
    "span[dir='ltr'].break-words",
    ".update-components-update-v2__commentary span",
]

REACTIONS_SELECTORS = [
    ".social-details-social-counts__reactions-count",
    "span.social-details-social-counts__reactions-count",
    "button[aria-label*='reaction'] span",
    "button[aria-label*='reactions'] span",
]

COMMENTS_SELECTORS = [
    ".social-details-social-counts__comments",
    "button[aria-label*='comment'] span",
    "button[aria-label*='comments'] span",
]

HASHTAG_SELECTOR = "a[href*='hashtag']"

# SDUI hashtag selector (new architecture)
SDUI_HASHTAG_SELECTOR = "a[href*='keywords=%23']"


# ---------------------------------------------------------------------------
# URL construction
# ---------------------------------------------------------------------------

def build_search_url(
    query: str,
    content_type: Optional[str] = "posts",
    industries: Optional[list[str]] = None,
) -> str:
    """
    Construct a LinkedIn content search URL.

    Args:
        query: The search string (supports AND/OR and quoted phrases).
        content_type: "posts", "jobs", or None (no content filter).
        industries: List of LinkedIn industry codes (e.g. ["14", "2045"]).
    """
    params: dict[str, Any] = {
        "keywords": query,
        "origin": "FACETED_SEARCH",
    }

    if content_type in ("posts", "jobs"):
        params["contentType"] = f'["{content_type}"]'

    if industries:
        params["authorIndustry"] = json_encode_list(industries)

    return config.LINKEDIN_SEARCH_BASE + "?" + urllib.parse.urlencode(params)


def json_encode_list(items: list[str]) -> str:
    """Encode a list as a JSON array string for LinkedIn URL parameters."""
    return "[" + ",".join(f'"{i}"' for i in items) + "]"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _first_text(element, selectors: list[str]) -> str:
    """Try each selector in order and return the first non-empty text found."""
    for selector in selectors:
        try:
            loc = element.locator(selector).first
            count = await loc.count()
            if count > 0:
                text = (await loc.inner_text()).strip()
                if text:
                    return text
        except Exception:
            continue
    return ""


async def _first_attr(element, selectors: list[str], attr: str) -> str:
    """Try each selector in order and return the first non-empty attribute."""
    for selector in selectors:
        try:
            loc = element.locator(selector).first
            count = await loc.count()
            if count > 0:
                value = await loc.get_attribute(attr)
                if value:
                    return value.strip()
        except Exception:
            continue
    return ""


def _clean_profile_url(url: str) -> str:
    """Strip tracking parameters from a LinkedIn profile URL."""
    if not url:
        return url
    try:
        parsed = urllib.parse.urlparse(url)
        return urllib.parse.urlunparse(parsed._replace(query="", fragment=""))
    except Exception:
        return url


def _parse_engagement_number(text: str) -> int:
    """Parse '1.2K' -> 1200, '500' -> 500, etc."""
    if not text:
        return 0
    text = text.strip().replace(",", "")
    try:
        if text.endswith("K") or text.endswith("k"):
            return int(float(text[:-1]) * 1000)
        if text.endswith("M") or text.endswith("m"):
            return int(float(text[:-1]) * 1_000_000)
        return int(float(text))
    except (ValueError, TypeError):
        return 0


def _synthetic_post_url(author_profile_url: str, post_text: str) -> str:
    """
    Build a stable synthetic URL for a post that has no direct activity URN
    in the DOM (new SDUI architecture).  Used as the unique DB key.
    """
    key = f"{author_profile_url}|{post_text[:200]}"
    digest = hashlib.sha256(key.encode("utf-8", errors="replace")).hexdigest()[:20]
    return f"https://www.linkedin.com/feed/post-ref/{digest}"


async def extract_page_activity_urns(page: Page) -> list[str]:
    """
    Extract all unique urn:li:activity:... values embedded anywhere in the
    current page (they live in the SDUI state JSON script tag).
    Returns a list in their first-occurrence order.
    """
    try:
        urns = await page.evaluate("""() => {
            const text = document.documentElement.innerHTML;
            const matches = text.match(/urn:li:activity:\\d+/g) || [];
            const seen = new Set();
            const ordered = [];
            for (const u of matches) {
                if (!seen.has(u)) { seen.add(u); ordered.push(u); }
            }
            return ordered;
        }""")
        return urns or []
    except Exception as exc:
        logger.debug("extract_page_activity_urns failed: %s", exc)
        return []


async def _sdui_find_urn_for_text(page: Page, post_text: str) -> Optional[str]:
    """
    Try to locate the activity URN for a post by searching for its text in
    the page's RSC/SDUI rehydration data and looking for a nearby URN.
    Returns None if not found.
    """
    if not post_text:
        return None
    fragment = post_text[:25]
    try:
        result = await page.evaluate("""(fragment) => {
            const r = window.__como_rehydration__;
            if (!r) return null;
            const rText = JSON.stringify(r);
            const pos = rText.indexOf(fragment);
            if (pos === -1) return null;
            const window_text = rText.substring(Math.max(0, pos - 3000), pos + 3000);
            const m = window_text.match(/urn:li:activity:(\\d+)/);
            return m ? 'urn:li:activity:' + m[1] : null;
        }""", fragment)
        return result
    except Exception as exc:
        logger.debug("_sdui_find_urn_for_text failed: %s", exc)
        return None


# ---------------------------------------------------------------------------
# Post card extraction — handles both DOM architectures
# ---------------------------------------------------------------------------

async def extract_post_card(
    element,
    search_query: str,
    source_search_url: str,
    page: Optional[Page] = None,
) -> Optional[dict]:
    """
    Extract all relevant fields from a single LinkedIn post card element.

    Supports two architectures:
      - Old (data-urn / data-id attributes): used on company pages and some
        older feed pages.
      - New SDUI (role=listitem, componentkey): used on home feed and search
        results pages since 2025-2026.

    Returns None if the element doesn't look like a real post.
    """
    # ---- Detect architecture -----------------------------------------------
    post_id = await element.get_attribute("data-urn") or await element.get_attribute("data-id")

    if post_id:
        # ---- Old architecture ------------------------------------------------
        author_name = await _first_text(element, AUTHOR_NAME_SELECTORS)
        if not author_name:
            return None

        author_headline = await _first_text(element, AUTHOR_HEADLINE_SELECTORS)
        author_profile_url = _clean_profile_url(
            await _first_attr(element, AUTHOR_LINK_SELECTORS, "href")
        )
        post_text = await _first_text(element, POST_TEXT_SELECTORS)

        reactions_raw = await _first_text(element, REACTIONS_SELECTORS)
        comments_raw = await _first_text(element, COMMENTS_SELECTORS)

        hashtag_els = element.locator(HASHTAG_SELECTOR)
        hashtag_count = await hashtag_els.count()
        hashtags: list[str] = []
        for i in range(hashtag_count):
            tag_text = (await hashtag_els.nth(i).inner_text()).strip()
            if tag_text:
                hashtags.append(tag_text)

        post_url = f"https://www.linkedin.com/feed/update/{post_id}/"

        return {
            "id": None,
            "post_url": post_url,
            "search_query": search_query,
            "source_search_url": source_search_url,
            "author_name": author_name,
            "author_headline": author_headline,
            "author_profile_url": author_profile_url,
            "post_text": post_text,
            "reactions_count": _parse_engagement_number(reactions_raw),
            "comments_count": _parse_engagement_number(comments_raw),
            "hashtags": hashtags,
        }

    # ---- New SDUI architecture -----------------------------------------------

    # Author name is embedded in the "Open control menu for post by [NAME]" button.
    # Items without this button are news cards / non-post elements — skip them.
    try:
        menu_btn = element.locator('[aria-label^="Open control menu for post by"]').first
        if await menu_btn.count() == 0:
            return None
        menu_label = await menu_btn.get_attribute("aria-label") or ""
        author_name = menu_label.replace("Open control menu for post by ", "").strip()
    except Exception:
        return None

    if not author_name:
        return None

    # Skip promoted / sponsored content
    try:
        full_text = (await element.inner_text()).lower()
        if "promoted" in full_text or "sponsored" in full_text:
            logger.debug("Skipping promoted post by %s", author_name)
            return None
    except Exception:
        pass

    # Author profile URL — first /in/ link in the post.
    # Posts by companies (pages) won't have /in/ links — we still accept them
    # but prefer posts with a real personal profile.
    author_profile_url = ""
    try:
        profile_link = element.locator('a[href*="linkedin.com/in/"]').first
        if await profile_link.count() > 0:
            href = await profile_link.get_attribute("href") or ""
            author_profile_url = _clean_profile_url(href)
    except Exception:
        pass

    # Post text
    post_text = ""
    try:
        text_el = element.locator('[data-testid="expandable-text-box"]').first
        if await text_el.count() > 0:
            post_text = (await text_el.inner_text()).strip()
    except Exception:
        pass

    # Hashtags from SDUI-style links (keywords=%23...)
    hashtags = []
    try:
        hashtag_els = element.locator(SDUI_HASHTAG_SELECTOR)
        hashtag_count = await hashtag_els.count()
        for i in range(hashtag_count):
            href = await hashtag_els.nth(i).get_attribute("href") or ""
            m = re.search(r"keywords=%23([^&]+)", href)
            if m:
                hashtags.append("#" + urllib.parse.unquote(m.group(1)))
        # Also try old-style hashtag selector as fallback
        if not hashtags:
            old_hashtag_els = element.locator(HASHTAG_SELECTOR)
            old_count = await old_hashtag_els.count()
            for i in range(old_count):
                tag_text = (await old_hashtag_els.nth(i).inner_text()).strip()
                if tag_text:
                    hashtags.append(tag_text)
    except Exception:
        pass

    # Post URL — try to find via page state; fall back to synthetic URL
    post_url = ""
    if page and post_text:
        try:
            urn = await _sdui_find_urn_for_text(page, post_text)
            if urn:
                post_url = f"https://www.linkedin.com/feed/update/{urn}/"
        except Exception:
            pass

    if not post_url:
        post_url = _synthetic_post_url(author_profile_url, post_text)

    # Author headline — not available in new SDUI DOM (obfuscated class names)
    author_headline = ""

    return {
        "id": None,
        "post_url": post_url,
        "search_query": search_query,
        "source_search_url": source_search_url,
        "author_name": author_name,
        "author_headline": author_headline,
        "author_profile_url": author_profile_url,
        "post_text": post_text,
        "reactions_count": 0,
        "comments_count": 0,
        "hashtags": hashtags,
    }


# ---------------------------------------------------------------------------
# Main scrape function
# ---------------------------------------------------------------------------

async def scrape_search_results(
    page: Page,
    query: str,
    max_pages: int = None,
    industries: Optional[list[str]] = None,
    filter_healthcare: bool = True,
    content_type: Optional[str] = "posts",
) -> list[dict]:
    """
    Navigate to LinkedIn search for `query`, scroll through results page by page,
    and return a list of post dicts.

    Args:
        page: Playwright Page object (should already be logged in).
        query: Search query string.
        max_pages: Override MAX_PAGES_PER_QUERY from config.
        industries: Industry code filter list.
        filter_healthcare: If True, applies healthcare industry codes by default.
        content_type: "posts", "jobs", or None (no filter). Passed to build_search_url.
    """
    if max_pages is None:
        max_pages = config.MAX_PAGES_PER_QUERY

    if filter_healthcare and industries is None:
        industries = config.HEALTHCARE_INDUSTRY_CODES

    search_url = build_search_url(query, content_type=content_type, industries=industries)
    logger.info("Scraping search: %s", search_url)

    await page.goto(search_url, wait_until="domcontentloaded", timeout=30_000)

    # Wait for JS-rendered content.  Try each ready selector up to 10 s each.
    _waited = False
    for _sel in READY_SELECTORS:
        try:
            await page.wait_for_selector(_sel, timeout=10_000)
            logger.debug("Search page ready — detected selector: %s", _sel)
            _waited = True
            break
        except Exception:
            continue
    if not _waited:
        logger.debug("wait_for_selector timed-out on all ready selectors; proceeding anyway")

    await action_delay()

    if await check_for_challenge(page):
        resolved = await wait_for_challenge_resolution(page)
        if not resolved:
            return []

    all_posts: list[dict] = []
    seen_ids: set[str] = set()

    for page_num in range(1, max_pages + 1):
        logger.info("Extracting posts from scroll batch %d/%d", page_num, max_pages)

        await scroll_to_bottom_gradually(page, max_scrolls=6)
        await short_delay()
        await move_mouse_randomly(page)

        # Try each container selector until we find posts
        post_elements = []
        matched_selector = ""
        for selector in POST_CONTAINER_SELECTORS:
            locator = page.locator(selector)
            count = await locator.count()
            if count > 0:
                post_elements = [locator.nth(i) for i in range(count)]
                matched_selector = selector
                logger.debug("Found %d post elements with selector: %s", count, selector)
                break

        if not post_elements:
            try:
                snippet = await page.evaluate(
                    "() => document.body.innerHTML.substring(0, 3000)"
                )
                logger.debug("Page HTML snippet (first 3000 chars):\n%s", snippet)
            except Exception:
                pass
            logger.warning("No post elements found on page %d, stopping.", page_num)
            break

        batch_new = 0
        for el in post_elements:
            try:
                # Pass page reference so SDUI posts can look up URNs
                post = await extract_post_card(el, query, search_url, page=page)
                if post and post.get("post_url") and post["post_url"] not in seen_ids:
                    seen_ids.add(post["post_url"])
                    all_posts.append(post)
                    batch_new += 1
            except Exception as exc:
                logger.debug("Error extracting post card: %s", exc)

        logger.info("Batch %d: extracted %d new posts (total: %d)", page_num, batch_new, len(all_posts))

        if await check_for_challenge(page):
            resolved = await wait_for_challenge_resolution(page)
            if not resolved:
                break

        if page_num < max_pages:
            await action_delay()

    logger.info("Scrape complete for query '%s': %d total posts", query, len(all_posts))
    return all_posts
