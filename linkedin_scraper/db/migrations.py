"""
Database migration helpers.

Responsibilities:
- Create all tables if they don't exist (idempotent).
- Provide upsert helpers for each major table.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from linkedin_scraper.db.models import (
    Base,
    LinkedInAuthor,
    LinkedInComment,
    LinkedInPost,
    ScrapeCheckpoint,
    ScrapeRun,
    get_engine,
)


def run_migrations(db_path: str) -> None:
    """Create all tables (idempotent). Safe to call on every run."""
    engine = get_engine(db_path)
    Base.metadata.create_all(engine)
    engine.dispose()


# ---------------------------------------------------------------------------
# Idempotent upsert helpers
# ---------------------------------------------------------------------------

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def generate_post_id(post_url: str) -> str:
    """Derive a stable ID from the post URL."""
    return hashlib.sha1(post_url.encode()).hexdigest()[:16]


def generate_comment_id(post_id: str, author_profile_url: str, comment_text: str) -> str:
    """Derive a stable comment ID from its key fields."""
    raw = f"{post_id}|{author_profile_url}|{comment_text[:100]}"
    return hashlib.sha1(raw.encode()).hexdigest()[:16]


def upsert_post(session: Session, data: dict[str, Any]) -> LinkedInPost:
    """
    Insert or update a LinkedIn post.
    The post's primary key is derived from its URL.
    Existing pain_point_score / is_relevant values are NOT overwritten.
    """
    post_url = data.get("post_url", "")
    post_id = data.get("id") or generate_post_id(post_url)

    existing = session.get(LinkedInPost, post_id)
    if existing:
        # Refresh scraped metadata but preserve human-set fields (is_relevant, notes)
        existing.author_name = data.get("author_name", existing.author_name)
        existing.author_headline = data.get("author_headline", existing.author_headline)
        existing.author_profile_url = data.get("author_profile_url", existing.author_profile_url)
        existing.post_text = data.get("post_text", existing.post_text)
        existing.reactions_count = data.get("reactions_count", existing.reactions_count)
        existing.comments_count = data.get("comments_count", existing.comments_count)
        existing.scraped_at = _now()
        if data.get("pain_point_score") is not None:
            existing.pain_point_score = data["pain_point_score"]
        if data.get("pain_point_category") is not None:
            existing.pain_point_category = data["pain_point_category"]
        if data.get("hashtags") is not None:
            existing.set_hashtags(data["hashtags"])
        return existing

    post = LinkedInPost(
        id=post_id,
        search_query=data.get("search_query"),
        post_url=post_url,
        author_name=data.get("author_name"),
        author_headline=data.get("author_headline"),
        author_profile_url=data.get("author_profile_url"),
        post_text=data.get("post_text"),
        reactions_count=data.get("reactions_count", 0),
        comments_count=data.get("comments_count", 0),
        posted_at=data.get("posted_at"),
        scraped_at=_now(),
        source_search_url=data.get("source_search_url"),
        pain_point_score=data.get("pain_point_score"),
        pain_point_category=data.get("pain_point_category"),
    )
    if data.get("hashtags"):
        post.set_hashtags(data["hashtags"])

    session.add(post)
    return post


def upsert_comment(session: Session, data: dict[str, Any]) -> LinkedInComment:
    """Insert or update a LinkedIn comment."""
    post_id = data["post_id"]
    author_url = data.get("author_profile_url", "")
    text_content = data.get("comment_text", "")
    comment_id = data.get("id") or generate_comment_id(post_id, author_url, text_content)

    existing = session.get(LinkedInComment, comment_id)
    if existing:
        existing.comment_text = text_content or existing.comment_text
        existing.reactions_count = data.get("reactions_count", existing.reactions_count)
        existing.scraped_at = _now()
        if data.get("is_executive") is not None:
            existing.is_executive = data["is_executive"]
        if data.get("pain_point_category") is not None:
            existing.pain_point_category = data["pain_point_category"]
        return existing

    comment = LinkedInComment(
        id=comment_id,
        post_id=post_id,
        author_name=data.get("author_name"),
        author_headline=data.get("author_headline"),
        author_profile_url=author_url,
        comment_text=text_content,
        reactions_count=data.get("reactions_count", 0),
        is_reply=data.get("is_reply", False),
        parent_comment_id=data.get("parent_comment_id"),
        scraped_at=_now(),
        is_executive=data.get("is_executive"),
        pain_point_category=data.get("pain_point_category"),
    )
    session.add(comment)
    return comment


def upsert_author(session: Session, profile_url: str, name: str, headline: str) -> LinkedInAuthor:
    """Insert or update an author record, incrementing seen counts."""
    existing = session.get(LinkedInAuthor, profile_url)
    now = _now()

    if existing:
        existing.name = name or existing.name
        existing.headline = headline or existing.headline
        existing.last_seen_at = now
        return existing

    author = LinkedInAuthor(
        profile_url=profile_url,
        name=name,
        headline=headline,
        first_seen_at=now,
        last_seen_at=now,
    )
    session.add(author)
    return author


def update_checkpoint(session: Session, search_query: str, last_post_url: str, pages_scraped: int) -> ScrapeCheckpoint:
    """Update scrape checkpoint for a given query (upsert)."""
    existing = session.get(ScrapeCheckpoint, search_query)
    if existing:
        existing.last_scraped_at = _now()
        existing.last_post_url = last_post_url
        existing.pages_scraped = pages_scraped
        return existing

    cp = ScrapeCheckpoint(
        search_query=search_query,
        last_scraped_at=_now(),
        last_post_url=last_post_url,
        pages_scraped=pages_scraped,
    )
    session.add(cp)
    return cp


def start_run(session: Session, search_query: str) -> ScrapeRun:
    run = ScrapeRun(started_at=_now(), search_query=search_query, status="running")
    session.add(run)
    session.commit()
    return run


def finish_run(session: Session, run: ScrapeRun, posts: int, comments: int, error: Optional[str] = None) -> None:
    from datetime import datetime
    started = datetime.fromisoformat(run.started_at)
    now_dt = datetime.now(timezone.utc)
    run.completed_at = now_dt.isoformat()
    run.posts_found = posts
    run.comments_found = comments
    run.status = "failed" if error else "completed"
    run.error_message = error
    # Ensure both datetimes are timezone-aware before subtraction
    if started.tzinfo is None:
        started = started.replace(tzinfo=timezone.utc)
    run.duration_seconds = (now_dt - started).total_seconds()
    session.commit()
