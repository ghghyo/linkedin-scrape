"""
Pain point scoring and classification.

Assigns each post/comment:
  - pain_point_category: which of the 4 healthcare pain categories it belongs to
  - pain_point_score: 0.0–1.0 float (higher = stronger signal)
  - is_executive: whether the author's headline indicates seniority

All logic here is keyword-based and deterministic (no LLM calls needed for
Phase 1/2). An NLP upgrade is planned for Phase 3.
"""

from __future__ import annotations

import re
from typing import Optional

from linkedin_scraper.config import EXECUTIVE_TITLE_KEYWORDS, SEARCH_QUERIES

# ---------------------------------------------------------------------------
# Category keyword maps (broader than the search queries —
# these catch synonyms and related language in post/comment text)
# ---------------------------------------------------------------------------

CATEGORY_KEYWORDS: dict[str, list[str]] = {
    "staffing_burnout": [
        "top of license", "staff burnout", "workforce shortage", "administrative burden",
        "care team", "wellbeing", "pajama time", "documentation burden", "clinician burnout",
        "physician burnout", "nurse burnout", "staffing crisis", "workforce resilience",
        "clinical staff", "retain staff", "retaining staff", "turnover", "attrition",
        "moral injury", "prior auth burden", "spend time on paperwork",
    ],
    "revenue_cycle": [
        "prior authorization", "prior auth", "denials management", "denial rate",
        "payer friction", "payer-provider", "revenue integrity", "clean claim",
        "eligibility verification", "eligibility automation", "revenue cycle",
        "rcm", "accounts receivable", "bad debt", "underpayment", "claim denial",
        "authorization reform", "cost to collect", "days in ar", "days in accounts receivable",
        "write-off", "write off", "reimbursement", "payer contract", "fee schedule",
    ],
    "technology_integration": [
        "interoperability", "ehr", "epic", "cerner", "meditech",
        "digital transformation", "frictionless", "reducing friction",
        "digital health roi", "technical debt", "integration", "workflow automation",
        "data silos", "legacy system", "system integration", "api", "fhir",
        "ehr optimization", "emr", "patient data", "care coordination technology",
    ],
    "financial_growth": [
        "operating margin", "operating margins", "ebitda", "cost to collect",
        "value-based care", "scalability", "scalable", "revenue growth",
        "margin pressure", "cost reduction", "operational efficiency",
        "financial performance", "roi", "dso", "dental support organization",
        "group practice", "multi-site", "scale", "profitability",
    ],
}

# Phrases that strongly indicate active pain / frustration (boost score)
PAIN_SIGNAL_PHRASES: list[str] = [
    "frustrated", "struggling", "challenge", "problem", "issue", "pain point",
    "burden", "manual process", "time consuming", "inefficient", "broken",
    "wasting time", "can't scale", "can't find", "hard to find", "impossible to",
    "need help", "looking for", "anyone else", "how do you", "what do you use",
    "help me", "advice", "recommendation", "still doing manually",
    "hours a day", "hours per week", "don't have time",
]

# Phrases that reduce score (positive/celebratory posts — not pain signals)
NOISE_PHRASES: list[str] = [
    "we're hiring", "we are hiring", "join our team", "exciting news",
    "proud to announce", "thrilled to share", "happy to share",
    "congratulations", "great to see", "proud to be", "award",
]


# ---------------------------------------------------------------------------
# Core functions
# ---------------------------------------------------------------------------

def detect_category(text: str) -> Optional[str]:
    """
    Return the pain point category with the most keyword matches,
    or None if no matches found.
    """
    if not text:
        return None

    lower_text = text.lower()
    scores: dict[str, int] = {}

    for category, keywords in CATEGORY_KEYWORDS.items():
        hits = sum(1 for kw in keywords if kw.lower() in lower_text)
        if hits > 0:
            scores[category] = hits

    if not scores:
        return None

    return max(scores, key=lambda k: scores[k])


def score_text(text: str) -> float:
    """
    Compute a pain point relevance score between 0.0 and 1.0 for a text.

    Scoring components:
    - Category keyword density (max 0.5)
    - Pain signal phrases (max 0.4)
    - Noise phrase penalty (up to -0.3)
    """
    if not text:
        return 0.0

    lower = text.lower()
    word_count = max(len(lower.split()), 1)

    # Category keyword hits
    category_hits = sum(
        1 for kw_list in CATEGORY_KEYWORDS.values()
        for kw in kw_list
        if kw.lower() in lower
    )
    category_score = min(category_hits / 3.0, 0.5)  # cap at 0.5

    # Pain signal hits
    pain_hits = sum(1 for phrase in PAIN_SIGNAL_PHRASES if phrase.lower() in lower)
    pain_score = min(pain_hits / 2.0, 0.4)  # cap at 0.4

    # Noise penalty
    noise_hits = sum(1 for phrase in NOISE_PHRASES if phrase.lower() in lower)
    noise_penalty = min(noise_hits * 0.15, 0.3)

    raw = category_score + pain_score - noise_penalty
    return round(max(0.0, min(raw, 1.0)), 3)


def is_executive(headline: str) -> bool:
    """
    Return True if the author's headline contains any executive title keyword.
    Case-insensitive. Checks whole-word and substring matches.
    """
    if not headline:
        return False

    lower = headline.lower()
    for title in EXECUTIVE_TITLE_KEYWORDS:
        if title.lower() in lower:
            return True
    return False


def classify_post(post: dict) -> dict:
    """
    Annotate a post dict with pain point classification fields.

    Input: post dict (must have 'post_text', 'author_headline')
    Output: same dict with added keys:
        pain_point_category, pain_point_score
    """
    text = post.get("post_text", "") or ""
    headline = post.get("author_headline", "") or ""

    post["pain_point_category"] = detect_category(text)
    post["pain_point_score"] = score_text(text)
    return post


def classify_comment(comment: dict) -> dict:
    """
    Annotate a comment dict with is_executive and pain point fields.

    Input: comment dict (must have 'comment_text', 'author_headline')
    Output: same dict with added keys:
        is_executive, pain_point_category, pain_point_score (internal only)
    """
    text = comment.get("comment_text", "") or ""
    headline = comment.get("author_headline", "") or ""

    comment["is_executive"] = is_executive(headline)
    comment["pain_point_category"] = detect_category(text)
    return comment


def apply_classifications_bulk(posts: list[dict], comments: list[dict]) -> tuple[list[dict], list[dict]]:
    """Classify all posts and comments in-place."""
    classified_posts = [classify_post(p) for p in posts]
    classified_comments = [classify_comment(c) for c in comments]
    return classified_posts, classified_comments
