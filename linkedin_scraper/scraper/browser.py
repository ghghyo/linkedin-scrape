"""
Playwright browser session manager.

Uses a PERSISTENT browser context so login cookies are saved between runs.
First run: script pauses for the operator to log in manually.
Subsequent runs: session is reused automatically.
"""

from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
from typing import AsyncGenerator

from playwright.async_api import (
    Browser,
    BrowserContext,
    Page,
    Playwright,
    async_playwright,
)

from linkedin_scraper import config
from linkedin_scraper.scraper.rate_limiter import check_for_challenge, short_delay

logger = logging.getLogger(__name__)

LINKEDIN_FEED_URL = "https://www.linkedin.com/feed/"
LINKEDIN_LOGIN_URL = "https://www.linkedin.com/login"


async def get_browser_context(playwright: Playwright) -> BrowserContext:
    """
    Return a persistent Playwright browser context.

    The session is stored in SESSION_DIR (default: data/linkedin_session/).
    This preserves cookies, localStorage, and service workers across runs so
    the user only needs to log in once.
    """
    session_dir = Path(config.SESSION_DIR)
    session_dir.mkdir(parents=True, exist_ok=True)

    context = await playwright.chromium.launch_persistent_context(
        user_data_dir=str(session_dir),
        headless=config.HEADLESS,
        viewport={"width": 1280, "height": 800},
        user_agent=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/121.0.0.0 Safari/537.36"
        ),
        locale="en-US",
        timezone_id="America/New_York",
        args=[
            "--disable-blink-features=AutomationControlled",
            "--no-sandbox",
        ],
        ignore_default_args=["--enable-automation"],
    )

    # Hide the navigator.webdriver flag that LinkedIn checks
    await context.add_init_script("""
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    """)

    return context


async def ensure_logged_in(page: Page) -> bool:
    """
    Check if the current LinkedIn session is active.

    If not logged in:
    - In headless=False mode: navigates to the login page and waits for the
      operator to log in manually (up to 5 minutes).
    - In headless=True mode: logs an error and returns False so the caller
      can abort the run.

    Returns True if logged in, False otherwise.
    """
    await page.goto(LINKEDIN_FEED_URL, wait_until="domcontentloaded", timeout=30_000)
    await short_delay()

    if _is_logged_in(page.url):
        logger.info("LinkedIn session active (URL: %s)", page.url)
        return True

    logger.warning("Not logged in to LinkedIn (redirected to: %s)", page.url)

    if config.HEADLESS:
        logger.error(
            "Cannot log in automatically in headless mode. "
            "Run 'python -m linkedin_scraper.cli login' with HEADLESS=false first "
            "to create a persistent session, then re-enable headless mode."
        )
        return False

    # Non-headless: navigate to login and wait for operator
    logger.info(
        "Browser opened at login page. Please log in manually. "
        "The script will continue automatically once you're on the feed."
    )
    await page.goto(LINKEDIN_LOGIN_URL, wait_until="domcontentloaded", timeout=30_000)

    # Wait until we land on a non-login URL (up to 5 minutes)
    max_wait = 300
    elapsed = 0
    while elapsed < max_wait:
        await asyncio.sleep(5)
        elapsed += 5
        if _is_logged_in(page.url):
            logger.info("Manual login successful.")
            return True
        logger.debug("Still waiting for login... (%ds elapsed)", elapsed)

    logger.error("Manual login timed out after %ds.", max_wait)
    return False


def _is_logged_in(url: str) -> bool:
    """Return True if the current URL looks like an authenticated LinkedIn page."""
    return "linkedin.com/feed" in url or (
        "linkedin.com" in url
        and "login" not in url
        and "checkpoint" not in url
        and "authwall" not in url
    )


async def get_new_page(context: BrowserContext) -> Page:
    """Open a new page in the context with some default settings."""
    page = await context.new_page()
    # Intercept and block heavy media to speed up page loads
    await page.route(
        "**/*.{png,jpg,jpeg,gif,webp,svg,mp4,woff,woff2}",
        lambda route: route.abort(),
    )
    return page


class LinkedInSession:
    """
    Async context manager wrapping the full Playwright session lifecycle.

    Usage:
        async with LinkedInSession() as session:
            await session.page.goto("https://www.linkedin.com/...")
    """

    def __init__(self) -> None:
        self._playwright: Playwright | None = None
        self._context: BrowserContext | None = None
        self.page: Page | None = None

    async def __aenter__(self) -> "LinkedInSession":
        self._playwright = await async_playwright().start()
        self._context = await get_browser_context(self._playwright)
        self.page = await get_new_page(self._context)
        return self

    async def __aexit__(self, *_exc) -> None:
        if self._context:
            try:
                await self._context.close()
            except Exception as exc:
                logger.debug("Browser context already closed / disconnected: %s", exc)
        if self._playwright:
            try:
                await self._playwright.stop()
            except Exception as exc:
                logger.debug("Playwright stop error (browser may have already exited): %s", exc)

    async def new_page(self) -> Page:
        """Open an additional page in the same context."""
        assert self._context is not None
        return await get_new_page(self._context)
