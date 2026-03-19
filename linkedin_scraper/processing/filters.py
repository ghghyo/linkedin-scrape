"""
Query helpers for filtering LinkedIn data stored in SQLite.
Used by both the export module and the CLI status command.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from linkedin_scraper.db.models import LinkedInComment, LinkedInPost


def _since_iso(days: int) -> str:
    """Return an ISO timestamp string `days` ago."""
    dt = datetime.now(timezone.utc) - timedelta(days=days)
    return dt.isoformat()


def posts_query(
    session: Session,
    since_days: Optional[int] = None,
    category: Optional[str] = None,
    reviewed_only: bool = False,
    min_score: float = 0.0,
    executive_only: bool = False,
):
    """
    Return a SQLAlchemy query for LinkedInPost with optional filters applied.
    """
    q = session.query(LinkedInPost)

    if since_days:
        q = q.filter(LinkedInPost.scraped_at >= _since_iso(since_days))

    if category:
        q = q.filter(LinkedInPost.pain_point_category == category)

    if reviewed_only:
        q = q.filter(LinkedInPost.is_relevant == True)  # noqa: E712

    if min_score > 0.0:
        q = q.filter(LinkedInPost.pain_point_score >= min_score)

    return q


def comments_query(
    session: Session,
    since_days: Optional[int] = None,
    category: Optional[str] = None,
    reviewed_only: bool = False,
    executive_only: bool = False,
):
    """
    Return a SQLAlchemy query for LinkedInComment with optional filters applied.
    """
    q = session.query(LinkedInComment)

    if since_days:
        q = q.filter(LinkedInComment.scraped_at >= _since_iso(since_days))

    if category:
        q = q.filter(LinkedInComment.pain_point_category == category)

    if reviewed_only:
        q = q.filter(LinkedInComment.is_relevant == True)  # noqa: E712

    if executive_only:
        q = q.filter(LinkedInComment.is_executive == True)  # noqa: E712

    return q
