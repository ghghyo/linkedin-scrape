"""
Human-like rate limiting and scroll simulation.

All delays and scroll distances use random values drawn from configured
min/max ranges to avoid detectable patterns.

LinkedIn's 2025-2026 SDUI redesign moved the scrollable viewport from the
document body to a ``<main>`` element with ``overflow-y: scroll``.  The
scroll helpers here detect and use the correct container automatically.
"""

from __future__ import annotations

import asyncio
import logging
import random
from typing import Optional

from playwright.async_api import Page

from linkedin_scraper import config

logger = logging.getLogger(__name__)

# JavaScript snippet that returns the right scroll container.
# In the SDUI layout: `<main>` with overflowY:scroll.
# Fallback: the window (for company pages and legacy layouts).
_JS_SCROLL_CONTAINER = """(() => {
    const main = document.querySelector('main');
    if (main) {
        const style = getComputedStyle(main);
        if (style.overflowY === 'scroll' || style.overflowY === 'auto') {
            if (main.scrollHeight > main.clientHeight + 10) return 'main';
        }
    }
    return 'window';
})()"""


# ---------------------------------------------------------------------------
# Delay helpers
# ---------------------------------------------------------------------------

async def short_delay() -> None:
    """1-3 second pause (between actions within a page)."""
    await asyncio.sleep(random.uniform(1.0, 3.0))


async def action_delay() -> None:
    """Configured min/max delay between major actions."""
    delay = random.uniform(config.DELAY_MIN_SECONDS, config.DELAY_MAX_SECONDS)
    logger.debug("Sleeping %.1fs (action delay)", delay)
    await asyncio.sleep(delay)


async def page_cooldown() -> None:
    """Longer pause between loading separate pages/queries (30-60s)."""
    delay = random.uniform(30.0, 60.0)
    logger.debug("Page cooldown: sleeping %.0fs", delay)
    await asyncio.sleep(delay)


async def between_queries_cooldown() -> None:
    """Even longer pause between different search queries (60-120s)."""
    delay = random.uniform(60.0, 120.0)
    logger.info("Between-queries cooldown: sleeping %.0fs", delay)
    await asyncio.sleep(delay)


# ---------------------------------------------------------------------------
# Scroll simulation
# ---------------------------------------------------------------------------

async def smooth_scroll_down(page: Page, distance: int = 800) -> None:
    """
    Scroll down by ``distance`` pixels in small increments to mimic human
    reading.  Detects whether the scrollable container is ``<main>`` (SDUI
    layout) or the window (legacy / company pages).
    """
    container = await page.evaluate(_JS_SCROLL_CONTAINER)
    steps = random.randint(5, 12)
    step_size = distance // steps
    for _ in range(steps):
        jitter = random.randint(-20, 20)
        px = step_size + jitter
        if container == "main":
            await page.evaluate(f"document.querySelector('main').scrollTop += {px}")
        else:
            await page.evaluate(f"window.scrollBy(0, {px})")
        await asyncio.sleep(random.uniform(0.05, 0.2))


async def _get_scroll_height(page: Page, container: str) -> int:
    if container == "main":
        return await page.evaluate(
            "document.querySelector('main')?.scrollHeight || 0"
        )
    return await page.evaluate("document.body.scrollHeight")


async def scroll_to_bottom_gradually(page: Page, max_scrolls: int = 8) -> None:
    """
    Gradually scroll toward the bottom of the page, pausing between scrolls.
    Stops when no new content appears or max_scrolls is reached.
    """
    container = await page.evaluate(_JS_SCROLL_CONTAINER)
    logger.debug("scroll_to_bottom_gradually: using '%s' container", container)

    prev_height = 0
    for i in range(max_scrolls):
        await smooth_scroll_down(page, distance=random.randint(600, 1200))
        await short_delay()

        current_height = await _get_scroll_height(page, container)
        if current_height == prev_height:
            logger.debug("No new content after scroll %d, stopping", i + 1)
            break
        prev_height = current_height

        if random.random() < 0.3:
            await asyncio.sleep(random.uniform(2.0, 5.0))


async def scroll_into_view(page: Page, selector: str) -> None:
    """Scroll an element into view with a smooth effect."""
    try:
        element = page.locator(selector).first
        await element.scroll_into_view_if_needed()
        await short_delay()
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Mouse movement helpers (reduces bot-like behavior)
# ---------------------------------------------------------------------------

async def move_mouse_randomly(page: Page) -> None:
    """Move the mouse to a random position on the page."""
    viewport = page.viewport_size
    if not viewport:
        return
    x = random.randint(100, viewport["width"] - 100)
    y = random.randint(100, viewport["height"] - 100)
    await page.mouse.move(x, y)
    await asyncio.sleep(random.uniform(0.1, 0.4))


# ---------------------------------------------------------------------------
# Challenge / block detection
# ---------------------------------------------------------------------------

CHALLENGE_INDICATORS: list[str] = [
    "verify you're a human",
    "let's do a quick security check",
    "please complete this security check",
    "unusual activity",
    "checkpoint",
    "we need to verify",
    "too many requests",
]


async def check_for_challenge(page: Page) -> bool:
    """
    Return True if LinkedIn is showing a challenge or block page.
    Logs a prominent warning so the operator can intervene.
    """
    try:
        content = (await page.content()).lower()
        for indicator in CHALLENGE_INDICATORS:
            if indicator in content:
                logger.warning(
                    "CHALLENGE DETECTED on page %s — '%s' found in page content. "
                    "Please open the browser and solve the challenge manually.",
                    page.url,
                    indicator,
                )
                return True
    except Exception as exc:
        logger.debug("Error checking for challenge: %s", exc)
    return False


async def wait_for_challenge_resolution(page: Page, timeout_seconds: int = 300) -> bool:
    """
    Poll every 10 seconds for up to ``timeout_seconds`` waiting for the challenge
    to be resolved by the human operator.
    Returns True once the challenge page is gone, False on timeout.
    """
    logger.warning(
        "Waiting up to %ds for challenge resolution on %s ...",
        timeout_seconds,
        page.url,
    )
    elapsed = 0
    while elapsed < timeout_seconds:
        await asyncio.sleep(10)
        elapsed += 10
        if not await check_for_challenge(page):
            logger.info("Challenge resolved after %ds.", elapsed)
            return True
    logger.error("Challenge NOT resolved after %ds. Aborting run.", timeout_seconds)
    return False
