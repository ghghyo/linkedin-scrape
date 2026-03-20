"""
CSV export in the pain point deliverable format.

Output columns:
    username | profile_link | text | thread_link | pain_point_category |
    author_headline | is_executive | scraped_at | pain_point_score

Two export modes:
    - export_posts_csv:    one row per post (poster is the lead)
    - export_comments_csv: one row per comment (commenter is the lead)
    - export_combined_csv: both merged into a single file
"""

from __future__ import annotations

import csv
import io
import logging
import os
import re
import urllib.parse
from datetime import datetime
from pathlib import Path
from typing import Optional

from sqlalchemy.orm import Session

from linkedin_scraper.db.models import LinkedInComment, LinkedInPost
from linkedin_scraper.processing.filters import comments_query, posts_query

logger = logging.getLogger(__name__)

CSV_HEADERS = [
    "username",
    "profile_link",
    "text",
    "thread_link",
    "pain_point_category",
    "author_headline",
    "is_executive",
    "scraped_at",
    "pain_point_score",
    "source_type",
]


def _safe(value) -> str:
    """Convert value to string, replacing None with empty string."""
    if value is None:
        return ""
    return str(value)


def _thread_link(value) -> str:
    """
    Export only real LinkedIn post URLs.

    Historical SDUI scraping could store synthetic `/feed/post-ref/...` URLs,
    which are only internal placeholders and always 404 if opened directly.
    """
    url = _safe(value)
    if not url or "/feed/post-ref/" in url:
        return ""
    try:
        parsed = urllib.parse.urlparse(url)
        cleaned = urllib.parse.urlunparse(parsed._replace(query="", fragment=""))
    except Exception:
        cleaned = url

    if re.search(r"linkedin\.com/posts/", cleaned, re.IGNORECASE):
        return cleaned
    if re.search(r"linkedin\.com/feed/update/urn:li:(activity|share|ugcPost):", cleaned, re.IGNORECASE):
        return cleaned
    return ""


def _bool_label(value) -> str:
    if value is True:
        return "yes"
    if value is False:
        return "no"
    return "unreviewed"


# ---------------------------------------------------------------------------
# Post export
# ---------------------------------------------------------------------------

def export_posts_csv(
    session: Session,
    since_days: Optional[int] = None,
    category: Optional[str] = None,
    reviewed_only: bool = False,
    min_score: float = 0.0,
) -> list[dict]:
    """Return rows (as dicts) for posts matching the given filters."""
    q = posts_query(session, since_days=since_days, category=category,
                    reviewed_only=reviewed_only, min_score=min_score)
    posts: list[LinkedInPost] = q.order_by(LinkedInPost.scraped_at.desc()).all()

    rows = []
    for p in posts:
        rows.append({
            "username": _safe(p.author_name),
            "profile_link": _safe(p.author_profile_url),
            "text": _safe(p.post_text),
            "thread_link": _thread_link(p.post_url),
            "pain_point_category": _safe(p.pain_point_category),
            "author_headline": _safe(p.author_headline),
            "is_executive": "",  # Posts: executive flag lives on comments
            "scraped_at": _safe(p.scraped_at),
            "pain_point_score": _safe(p.pain_point_score),
            "source_type": "post",
        })
    return rows


# ---------------------------------------------------------------------------
# Comment export
# ---------------------------------------------------------------------------

def export_comments_csv(
    session: Session,
    since_days: Optional[int] = None,
    category: Optional[str] = None,
    reviewed_only: bool = False,
    executive_only: bool = False,
) -> list[dict]:
    """Return rows (as dicts) for comments matching the given filters."""
    q = comments_query(session, since_days=since_days, category=category,
                       reviewed_only=reviewed_only, executive_only=executive_only)
    comments: list[LinkedInComment] = q.order_by(LinkedInComment.scraped_at.desc()).all()

    rows = []
    for c in comments:
        # Look up the parent post URL
        post_url = ""
        if c.post:
            post_url = _thread_link(c.post.post_url)

        rows.append({
            "username": _safe(c.author_name),
            "profile_link": _safe(c.author_profile_url),
            "text": _safe(c.comment_text),
            "thread_link": post_url,
            "pain_point_category": _safe(c.pain_point_category),
            "author_headline": _safe(c.author_headline),
            "is_executive": _bool_label(c.is_executive),
            "scraped_at": _safe(c.scraped_at),
            "pain_point_score": "",
            "source_type": "comment",
        })
    return rows


# ---------------------------------------------------------------------------
# Combined export
# ---------------------------------------------------------------------------

def export_combined_csv(
    session: Session,
    since_days: Optional[int] = None,
    category: Optional[str] = None,
    reviewed_only: bool = False,
    executive_only: bool = False,
    min_score: float = 0.0,
) -> list[dict]:
    """Merge posts and comments into a single sorted list."""
    post_rows = export_posts_csv(session, since_days=since_days, category=category,
                                 reviewed_only=reviewed_only, min_score=min_score)
    comment_rows = export_comments_csv(session, since_days=since_days, category=category,
                                       reviewed_only=reviewed_only, executive_only=executive_only)
    all_rows = post_rows + comment_rows
    # Sort newest first
    all_rows.sort(key=lambda r: r.get("scraped_at", ""), reverse=True)
    return all_rows


# ---------------------------------------------------------------------------
# Write to file
# ---------------------------------------------------------------------------

def write_csv(rows: list[dict], output_path: str) -> str:
    """
    Write rows to a CSV file.
    Returns the resolved absolute path.
    Creates parent directories if needed.
    """
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)

    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_HEADERS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)

    logger.info("Exported %d rows to %s", len(rows), path.resolve())
    return str(path.resolve())


def default_output_path(prefix: str = "linkedin_pain_points") -> str:
    """Generate a timestamped output path in the reports/ directory."""
    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    return os.path.join("reports", f"{prefix}_{ts}.csv")
