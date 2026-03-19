"""
Central configuration: search queries, executive title filters, industry codes,
and runtime settings loaded from environment variables.
"""

import os
from dotenv import load_dotenv

load_dotenv()

# ---------------------------------------------------------------------------
# Runtime settings (all overridable via .env)
# ---------------------------------------------------------------------------

DB_PATH: str = os.getenv("DB_PATH", "data/linkedin_scraper.db")
SESSION_DIR: str = os.getenv("SESSION_DIR", "data/linkedin_session")
LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")
HEADLESS: bool = os.getenv("HEADLESS", "true").lower() == "true"

MAX_PAGES_PER_QUERY: int = int(os.getenv("MAX_PAGES_PER_QUERY", "3"))
MAX_POSTS_TO_EXPAND: int = int(os.getenv("MAX_POSTS_TO_EXPAND", "20"))
DELAY_MIN_SECONDS: float = float(os.getenv("DELAY_MIN_SECONDS", "2"))
DELAY_MAX_SECONDS: float = float(os.getenv("DELAY_MAX_SECONDS", "8"))

CLICKUP_API_TOKEN: str = os.getenv("CLICKUP_API_TOKEN", "")
CLICKUP_LIST_ID: str = os.getenv("CLICKUP_LIST_ID", "")
CLICKUP_TEAM_ID: str = os.getenv("CLICKUP_TEAM_ID", "")
CLICKUP_SPACE_ID: str = os.getenv("CLICKUP_SPACE_ID", "")
CLICKUP_FOLDER_ID: str = os.getenv("CLICKUP_FOLDER_ID", "")

# ---------------------------------------------------------------------------
# LinkedIn industry filter codes
# These map to LinkedIn's authorIndustry URL parameter.
# ---------------------------------------------------------------------------

HEALTHCARE_INDUSTRY_CODES: list[str] = [
    "14",    # Hospital & Health Care
    "13",    # Medical Practice (V1 — catches dental practices and solo practitioners)
    "2045",  # Medical Practice (V2)
    # "124", # Health, Wellness and Fitness — uncomment to broaden to wellness/cosmetic dental
]

# Note: LinkedIn has no dedicated "Dental" industry code.
# DSO/dental executives typically list their industry as Hospital & Health Care (14)
# or Medical Practice (13/2045). Dental-specific content is caught by keyword
# filters in SEARCH_QUERIES (e.g., "DSO", "Dental Support Organization", "EBITDA growth DSO").

# ---------------------------------------------------------------------------
# Executive title keywords for filtering commenters / post authors.
# A commenter whose headline contains ANY of these is flagged is_executive=True.
# ---------------------------------------------------------------------------

EXECUTIVE_TITLE_KEYWORDS: list[str] = [
    # C-Suite
    "CEO", "CFO", "COO", "CMO", "CIO", "CTO", "CHRO", "CNO", "CSO", "CPO",
    "Chief Executive", "Chief Financial", "Chief Operating", "Chief Marketing",
    "Chief Information", "Chief Technology", "Chief Human Resources",
    "Chief Nursing", "Chief Strategy", "Chief Product",
    # VP and above
    "VP ", "Vice President", "SVP", "Senior Vice President",
    "EVP", "Executive Vice President",
    # Director and above
    "Director", "Managing Director", "Senior Director", "Executive Director",
    # Other senior titles
    "President", "Partner", "Head of", "General Manager",
    "Owner", "Founder", "Co-Founder", "Principal",
    "Administrator", "Superintendent",
    # Healthcare-specific senior roles
    "Medical Director", "Clinical Director", "Revenue Cycle Director",
    "RCM Director", "Practice Administrator", "Group Practice",
    "DSO", "Dental Support Organization",
]

# ---------------------------------------------------------------------------
# Search queries organised by pain point category.
#
# Structure:
#   SEARCH_QUERIES = {
#       "category_key": {
#           "label": "Human-readable label",
#           "queries": ["query1", "query2", ...],
#       }
#   }
#
# Each query string is passed directly to LinkedIn search.
# LinkedIn search supports quoted phrases and AND/OR operators.
# ---------------------------------------------------------------------------

SEARCH_QUERIES: dict[str, dict] = {
    "staffing_burnout": {
        "label": "Staffing & Burnout",
        "description": (
            "Executives discussing workforce shortages, burnout, and the desire "
            "to free clinical staff from administrative work."
        ),
        "queries": [
            '"top of license"',
            '"staff burnout" "workforce shortages"',
            '"administrative burden"',
            '"care team wellbeing"',
            '"workforce resilience"',
            '"clinical vs administrative"',
        ],
    },
    "revenue_cycle": {
        "label": "Revenue Cycle & Insurance",
        "description": (
            "Executives discussing denials, prior authorization friction, "
            "eligibility verification, and clean claim rates."
        ),
        "queries": [
            '"prior authorization reform"',
            '"denials management"',
            '"payer-provider friction"',
            '"revenue integrity"',
            '"clean claim rate"',
            '"eligibility automation"',
            '"revenue cycle management" AI',
        ],
    },
    "technology_integration": {
        "label": "Technology & Integration",
        "description": (
            "Executives discussing EHR pain, interoperability gaps, "
            "digital transformation ROI, and technical debt."
        ),
        "queries": [
            '"interoperability"',
            '"EHR optimization"',
            '"Epic optimization"',
            '"Cerner optimization"',
            '"frictionless patient journey"',
            '"reducing friction" healthcare',
            '"digital health ROI"',
            '"technical debt in healthcare"',
        ],
    },
    "financial_growth": {
        "label": "Financial & Growth",
        "description": (
            "Executives discussing margin pressure, cost-to-collect, "
            "EBITDA growth, and scalability."
        ),
        "queries": [
            '"operating margins" healthcare',
            '"EBITDA growth" DSO',
            '"cost to collect"',
            '"value-based care"',
            '"scalability in healthcare"',
            '"operational excellence" healthcare',
        ],
    },
    "combo_gold_mine": {
        "label": "Gold Mine Combinations",
        "description": (
            "High-signal combinations that find posts where executives are "
            "actively expressing frustration or asking for solutions."
        ),
        "queries": [
            '"administrative burden" "prior authorization"',
            '"DSO" "revenue cycle" "staffing"',
            '"EHR" "burnout" "automation"',
            '"pajama time" healthcare',
            '"administrative burden" AND "prior authorization"',
            '"DSO" AND "revenue cycle" AND "staffing"',
            '"EHR" AND "burnout" AND "automation"',
        ],
    },
}

# Flat list of all queries for convenience (used by the daily pipeline runner)
ALL_QUERIES: list[dict] = [
    {"category": cat_key, "query": q, "label": cat_data["label"]}
    for cat_key, cat_data in SEARCH_QUERIES.items()
    for q in cat_data["queries"]
]

# High-priority queries run first (these are the "Gold Mine" combos)
PRIORITY_QUERIES: list[dict] = [
    {"category": cat_key, "query": q, "label": cat_data["label"]}
    for cat_key, cat_data in SEARCH_QUERIES.items()
    if cat_key == "combo_gold_mine"
    for q in cat_data["queries"]
]

# ---------------------------------------------------------------------------
# LinkedIn URL base
# ---------------------------------------------------------------------------

LINKEDIN_BASE_URL = "https://www.linkedin.com"
LINKEDIN_SEARCH_BASE = "https://www.linkedin.com/search/results/content/"
