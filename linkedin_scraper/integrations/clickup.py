"""
ClickUp integration.

Creates one ClickUp task per qualifying finding (post or comment).
Deduplication is handled via the `clickup_tasks` SQLite table — if a
source_id already has a ClickUp task, it won't be created again.

Task format mirrors the Reddit pipeline's daily review task pattern.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

import httpx
from sqlalchemy.orm import Session

from linkedin_scraper import config
from linkedin_scraper.db.models import ClickUpTask, LinkedInComment, LinkedInPost

logger = logging.getLogger(__name__)

CLICKUP_API_BASE = "https://api.clickup.com/api/v2"

CATEGORY_LABELS: dict[str, str] = {
    "staffing_burnout": "Staffing & Burnout",
    "revenue_cycle": "Revenue Cycle & Insurance",
    "technology_integration": "Technology & Integration",
    "financial_growth": "Financial & Growth",
    "combo_gold_mine": "Gold Mine Combination",
}


# ---------------------------------------------------------------------------
# ClickUp API helpers
# ---------------------------------------------------------------------------

def _headers(api_token: str) -> dict[str, str]:
    return {
        "Authorization": api_token,
        "Content-Type": "application/json",
    }


async def list_teams(api_token: str) -> list[dict]:
    """List all ClickUp teams (workspaces) accessible with the token."""
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(f"{CLICKUP_API_BASE}/team", headers=_headers(api_token))
        r.raise_for_status()
        return r.json().get("teams", [])


async def list_spaces(api_token: str, team_id: str) -> list[dict]:
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(
            f"{CLICKUP_API_BASE}/team/{team_id}/space",
            headers=_headers(api_token),
        )
        r.raise_for_status()
        return r.json().get("spaces", [])


async def list_folders(api_token: str, space_id: str) -> list[dict]:
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(
            f"{CLICKUP_API_BASE}/space/{space_id}/folder",
            headers=_headers(api_token),
        )
        r.raise_for_status()
        return r.json().get("folders", [])


async def list_lists(api_token: str, folder_id: str) -> list[dict]:
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(
            f"{CLICKUP_API_BASE}/folder/{folder_id}/list",
            headers=_headers(api_token),
        )
        r.raise_for_status()
        return r.json().get("lists", [])


async def create_task(api_token: str, list_id: str, payload: dict) -> dict:
    """Create a task in ClickUp. Returns the full task response dict."""
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            f"{CLICKUP_API_BASE}/list/{list_id}/task",
            headers=_headers(api_token),
            json=payload,
        )
        r.raise_for_status()
        return r.json()


async def smoke_test(api_token: str, list_id: str) -> bool:
    """
    Verify API token + list access by listing teams and creating a test task.
    Returns True on success.
    """
    try:
        teams = await list_teams(api_token)
        logger.info("Smoke test: found %d teams", len(teams))

        test_payload = {
            "name": "[LinkedIn Scraper] Smoke test task — safe to delete",
            "description": "Automatically created by linkedin_scraper smoke test.",
            "status": "to do",
        }
        task = await create_task(api_token, list_id, test_payload)
        logger.info("Smoke test: task created with id=%s", task.get("id"))
        return True
    except Exception as exc:
        logger.error("Smoke test failed: %s", exc)
        return False


# ---------------------------------------------------------------------------
# Task formatting
# ---------------------------------------------------------------------------

def _truncate(text: str, max_len: int = 200) -> str:
    if not text:
        return ""
    text = text.strip()
    if len(text) <= max_len:
        return text
    return text[:max_len].rstrip() + "…"


def format_post_task(post: LinkedInPost) -> dict:
    """Format a LinkedInPost as a ClickUp task payload."""
    category_label = CATEGORY_LABELS.get(post.pain_point_category or "", "Uncategorized")
    title = f"[LinkedIn Lead] {post.author_name or 'Unknown'} — {category_label}"

    description_lines = [
        f"**Pain Point Category:** {category_label}",
        f"**Author:** {post.author_name or 'N/A'}",
        f"**Headline:** {post.author_headline or 'N/A'}",
        f"**Profile:** {post.author_profile_url or 'N/A'}",
        f"**Post URL:** {post.post_url or 'N/A'}",
        f"**Relevance Score:** {post.pain_point_score or 0:.2f}",
        "",
        "**Post Text (excerpt):**",
        _truncate(post.post_text or "", 500),
        "",
        f"*Scraped: {post.scraped_at}*",
        "*Source: LinkedIn Pain Point Scraper*",
    ]

    return {
        "name": title,
        "description": "\n".join(description_lines),
        "status": "to do",
        "tags": ["linkedin-lead", category_label.lower().replace(" & ", "-").replace(" ", "-")],
    }


def format_comment_task(comment: LinkedInComment) -> dict:
    """Format a LinkedInComment as a ClickUp task payload."""
    category_label = CATEGORY_LABELS.get(comment.pain_point_category or "", "Uncategorized")
    exec_flag = " [EXEC]" if comment.is_executive else ""
    title = f"[LinkedIn Lead{exec_flag}] {comment.author_name or 'Unknown'} — {category_label}"

    post_url = comment.post.post_url if comment.post else "N/A"

    description_lines = [
        f"**Pain Point Category:** {category_label}",
        f"**Commenter:** {comment.author_name or 'N/A'}",
        f"**Headline:** {comment.author_headline or 'N/A'}",
        f"**Profile:** {comment.author_profile_url or 'N/A'}",
        f"**Thread URL:** {post_url}",
        f"**Is Executive:** {'Yes' if comment.is_executive else 'No'}",
        "",
        "**Comment Text:**",
        _truncate(comment.comment_text or "", 500),
        "",
        f"*Scraped: {comment.scraped_at}*",
        "*Source: LinkedIn Pain Point Scraper*",
    ]

    tags = ["linkedin-lead", category_label.lower().replace(" & ", "-").replace(" ", "-")]
    if comment.is_executive:
        tags.append("executive")

    return {
        "name": title,
        "description": "\n".join(description_lines),
        "status": "to do",
        "tags": tags,
    }


# ---------------------------------------------------------------------------
# Deduplication
# ---------------------------------------------------------------------------

def is_already_pushed(session: Session, source_type: str, source_id: str) -> bool:
    """Return True if a ClickUp task has already been created for this source."""
    existing = (
        session.query(ClickUpTask)
        .filter_by(source_type=source_type, source_id=source_id)
        .first()
    )
    return existing is not None


def record_pushed_task(
    session: Session,
    clickup_task_id: str,
    source_type: str,
    source_id: str,
    title: str,
    category: Optional[str],
) -> ClickUpTask:
    task = ClickUpTask(
        clickup_task_id=clickup_task_id,
        source_type=source_type,
        source_id=source_id,
        created_at=datetime.now(timezone.utc).isoformat(),
        title=title,
        pain_point_category=category,
    )
    session.add(task)
    session.commit()
    return task


# ---------------------------------------------------------------------------
# Push functions
# ---------------------------------------------------------------------------

async def push_post(
    session: Session,
    post: LinkedInPost,
    api_token: str,
    list_id: str,
) -> Optional[str]:
    """
    Create a ClickUp task for a post (if not already pushed).
    Returns the ClickUp task ID or None.
    """
    if is_already_pushed(session, "post", post.id):
        logger.debug("Post %s already pushed to ClickUp, skipping.", post.id)
        return None

    payload = format_post_task(post)
    try:
        task = await create_task(api_token, list_id, payload)
        task_id = task["id"]
        record_pushed_task(session, task_id, "post", post.id, payload["name"], post.pain_point_category)
        logger.info("Created ClickUp task %s for post %s", task_id, post.id)
        return task_id
    except Exception as exc:
        logger.error("Failed to create ClickUp task for post %s: %s", post.id, exc)
        return None


async def push_comment(
    session: Session,
    comment: LinkedInComment,
    api_token: str,
    list_id: str,
) -> Optional[str]:
    """
    Create a ClickUp task for a comment (if not already pushed).
    Returns the ClickUp task ID or None.
    """
    if is_already_pushed(session, "comment", comment.id):
        logger.debug("Comment %s already pushed to ClickUp, skipping.", comment.id)
        return None

    payload = format_comment_task(comment)
    try:
        task = await create_task(api_token, list_id, payload)
        task_id = task["id"]
        record_pushed_task(session, task_id, "comment", comment.id, payload["name"], comment.pain_point_category)
        logger.info("Created ClickUp task %s for comment %s", task_id, comment.id)
        return task_id
    except Exception as exc:
        logger.error("Failed to create ClickUp task for comment %s: %s", comment.id, exc)
        return None


async def push_reviewed_findings(
    session: Session,
    api_token: str,
    list_id: str,
    executive_only: bool = False,
) -> dict[str, int]:
    """
    Push all reviewed (is_relevant=True) posts and comments to ClickUp.
    Skips anything already pushed (dedup).

    Returns counts: {"posts_pushed": N, "comments_pushed": M, "skipped": K}
    """
    from linkedin_scraper.db.models import LinkedInComment, LinkedInPost

    posts = session.query(LinkedInPost).filter_by(is_relevant=True).all()
    comments_q = session.query(LinkedInComment).filter_by(is_relevant=True)
    if executive_only:
        comments_q = comments_q.filter_by(is_executive=True)
    comments = comments_q.all()

    posts_pushed = 0
    comments_pushed = 0
    skipped = 0

    for post in posts:
        task_id = await push_post(session, post, api_token, list_id)
        if task_id:
            posts_pushed += 1
        else:
            skipped += 1

    for comment in comments:
        task_id = await push_comment(session, comment, api_token, list_id)
        if task_id:
            comments_pushed += 1
        else:
            skipped += 1

    return {
        "posts_pushed": posts_pushed,
        "comments_pushed": comments_pushed,
        "skipped": skipped,
    }
