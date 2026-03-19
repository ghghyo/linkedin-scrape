"""
SQLAlchemy ORM models for the LinkedIn scraper SQLite database.
"""

from datetime import datetime, timezone
from typing import Optional
import json

from sqlalchemy import (
    Boolean, Column, Float, ForeignKey, Integer, String, Text, create_engine,
    event,
)
from sqlalchemy.orm import DeclarativeBase, Session, relationship


class Base(DeclarativeBase):
    pass


# ---------------------------------------------------------------------------
# Tables
# ---------------------------------------------------------------------------

class LinkedInPost(Base):
    __tablename__ = "linkedin_posts"

    id = Column(String, primary_key=True)          # URN or generated hash
    search_query = Column(String)
    post_url = Column(String, unique=True)
    author_name = Column(String)
    author_headline = Column(String)
    author_profile_url = Column(String)
    post_text = Column(Text)
    reactions_count = Column(Integer, default=0)
    comments_count = Column(Integer, default=0)
    hashtags = Column(Text)                         # JSON array stored as text
    posted_at = Column(String)
    scraped_at = Column(String, nullable=False)
    source_search_url = Column(String)
    is_relevant = Column(Boolean, default=None)     # NULL = unreviewed
    pain_point_score = Column(Float, default=None)
    pain_point_category = Column(String)
    notes = Column(Text)

    comments = relationship("LinkedInComment", back_populates="post", cascade="all, delete-orphan")

    def set_hashtags(self, tags: list[str]) -> None:
        self.hashtags = json.dumps(tags)

    def get_hashtags(self) -> list[str]:
        if not self.hashtags:
            return []
        return json.loads(self.hashtags)

    def __repr__(self) -> str:
        return f"<LinkedInPost id={self.id!r} author={self.author_name!r}>"


class LinkedInComment(Base):
    __tablename__ = "linkedin_comments"

    id = Column(String, primary_key=True)
    post_id = Column(String, ForeignKey("linkedin_posts.id"))
    author_name = Column(String)
    author_headline = Column(String)
    author_profile_url = Column(String)
    comment_text = Column(Text)
    reactions_count = Column(Integer, default=0)
    is_reply = Column(Boolean, default=False)
    parent_comment_id = Column(String)
    scraped_at = Column(String, nullable=False)
    is_executive = Column(Boolean, default=None)   # NULL = not yet evaluated
    is_relevant = Column(Boolean, default=None)
    pain_point_category = Column(String)
    notes = Column(Text)

    post = relationship("LinkedInPost", back_populates="comments")

    def __repr__(self) -> str:
        return f"<LinkedInComment id={self.id!r} author={self.author_name!r}>"


class LinkedInAuthor(Base):
    __tablename__ = "linkedin_authors"

    profile_url = Column(String, primary_key=True)
    name = Column(String)
    headline = Column(String)
    is_executive = Column(Boolean, default=None)
    first_seen_at = Column(String)
    last_seen_at = Column(String)
    post_count = Column(Integer, default=0)
    comment_count = Column(Integer, default=0)

    def __repr__(self) -> str:
        return f"<LinkedInAuthor name={self.name!r} executive={self.is_executive}>"


class ScrapeRun(Base):
    __tablename__ = "scrape_runs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    started_at = Column(String, nullable=False)
    completed_at = Column(String)
    search_query = Column(String)
    posts_found = Column(Integer, default=0)
    comments_found = Column(Integer, default=0)
    status = Column(String, default="running")      # running | completed | failed
    error_message = Column(Text)
    duration_seconds = Column(Float)

    def __repr__(self) -> str:
        return f"<ScrapeRun id={self.id} status={self.status!r} query={self.search_query!r}>"


class ClickUpTask(Base):
    __tablename__ = "clickup_tasks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    clickup_task_id = Column(String, unique=True)
    source_type = Column(String)    # "post" | "comment"
    source_id = Column(String)      # id from linkedin_posts or linkedin_comments
    created_at = Column(String)
    title = Column(Text)
    pain_point_category = Column(String)

    def __repr__(self) -> str:
        return f"<ClickUpTask clickup_task_id={self.clickup_task_id!r}>"


class ScrapeCheckpoint(Base):
    __tablename__ = "scrape_checkpoints"

    search_query = Column(String, primary_key=True)
    last_scraped_at = Column(String)
    last_post_url = Column(String)
    pages_scraped = Column(Integer, default=0)

    def __repr__(self) -> str:
        return f"<ScrapeCheckpoint query={self.search_query!r} pages={self.pages_scraped}>"


# ---------------------------------------------------------------------------
# Engine factory
# ---------------------------------------------------------------------------

def get_engine(db_path: str):
    """Create and return a SQLAlchemy engine for the given SQLite path."""
    engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
    )
    # Enable WAL mode for better concurrent read performance
    @event.listens_for(engine, "connect")
    def set_wal_mode(dbapi_conn, _connection_record):
        dbapi_conn.execute("PRAGMA journal_mode=WAL")
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    return engine


def get_session(engine) -> Session:
    return Session(engine)
