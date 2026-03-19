# LinkedIn Lead & Pain Point Scraper Platform

A comprehensive platform for identifying healthcare industry pain points and generating high-value leads on LinkedIn. This tool handles LinkedIn's 2026 "SDUI" architecture, including dynamic scrolling and obfuscated selectors.

---

## 🛠️ LinkedIn Scraper CLI (Main Tool)

This is the core automation engine used for bulk scraping posts, comments, and job listings.

### 💻 Installation (New Computer Setup)

1.  **Prerequisites**: Ensure you have Python 3.10 or higher installed.
2.  **Clone/Download the Repository**:
    ```bash
    git clone <repo-url>
    cd commenter-main
    ```
3.  **Install Dependencies**:
    ```bash
    pip install -e .
    python -m playwright install chromium
    ```

### ⚙️ Configuration Setup

Before running the scraper, you must set up your environment variables:

1.  **Locate the `.env.example` file** in the project root.
2.  **Create your `.env` file**:
    -   **Windows (PowerShell)**:
        ```powershell
        cp .env.example .env
        ```
    -   **Mac/Linux**:
        ```bash
        cp .env.example .env
        ```
3.  **Open `.env` in a text editor** and verify the settings.
    -   **Crucial Note**: Always keep `HEADLESS=false` in your `.env` file if you want to see the browser window while the scraper is running. Set it to `true` only if you want the process to be invisible.

4.  **Initialize the Database**:
    ```bash
    python -m linkedin_scraper.cli db-migrate
    ```

### 🔑 Initial Login (One-Time)

LinkedIn requires a valid session. Run the login command to open a browser and log in manually. Your session will be saved persistently for future automated runs.

```bash
python -m linkedin_scraper.cli login
```

---

### 🚀 Usage Guide

#### 1. Scrape Search Results (Posts & Jobs)
Search for specific keywords and extract high-signal posts.

-   **General Posts (Default)**:
    ```bash
    python -m linkedin_scraper.cli scrape-search --query "Revenue Cycle Management" --max-pages 3
    ```
-   **Job Postings Only**:
    ```bash
    python -m linkedin_scraper.cli scrape-search --query "Medical Billing" --content-type jobs --max-pages 2
    ```
-   **Custom Category**: Label your results for better organization in the DB.
    ```bash
    python -m linkedin_scraper.cli scrape-search --query "prior authorization" --category "insurance-denials"
    ```

#### 2. Scrape Your Personal Feed
Monitor your network's activity for organic pain point signals.

```bash
python -m linkedin_scraper.cli scrape-feed --max-scrolls 5
```

#### 3. Scrape a Company Page
Extract all posts (and optionally all comments) from a specific company.

```bash
python -m linkedin_scraper.cli scrape-company --url "https://www.linkedin.com/company/athenahealth/" --expand-comments
```

#### 4. Expand High-Signal Comments
After scraping posts, you can go back and extract comments for posts that show high engagement (e.g., >5 comments).

```bash
python -m linkedin_scraper.cli scrape-comments --since 24h --min-comments 5
```

#### 5. Export & Review
Export your findings to a CSV file for human review.

```bash
python -m linkedin_scraper.cli export-csv --since 7d --output "healthcare_leads.csv"
```

---

## 🔧 Troubleshooting

-   **Scraper returns 0 posts**: 
    -   Ensure you are logged in (`python -m linkedin_scraper.cli login`).
    -   LinkedIn might be showing a security challenge. Ensure `HEADLESS=false` is set in your `.env` so you can solve it manually.
-   **Scrolling issues**: The scraper is optimized for the 2026 LinkedIn layout. If scrolling stops working, ensure your browser window is not minimized.
-   **Encoding Errors (Windows)**: If you see strange characters or errors in PowerShell, the CLI is pre-configured to handle UTF-8, but ensure your terminal supports Unicode.

---

## 📁 File Structure

-   `linkedin_scraper/`: Python package for the automation engine.
    -   `cli.py`: Command-line interface.
    -   `scraper/`: Logic for search, feed, and company scraping.
    -   `db/`: Database models and migrations (SQLite).
-   `data/`: (Auto-created) Stores your SQLite database and browser session.
-   `reports/`: (Auto-created) Stores exported CSV files.

---

## 🎁 Bonus: LinkedIn Comment Generator (Chrome Extension)

*Note: You can ignore this initially. This is an optional tool for manual engagement.*

The Chrome extension helps you generate AI-powered responses to the posts you find.

### Installation
1.  Open Chrome and go to `chrome://extensions/`.
2.  Enable **Developer mode** (top right).
3.  Click **Load unpacked** and select the root folder of this repository.
4.  Pin the extension to your toolbar.

### Workflow
1.  **Get API Key**: Obtain a free Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey).
2.  **Highlight Text**: On any LinkedIn post, highlight the text you want to respond to.
3.  **Generate**: Click the extension icon (or `Ctrl+Q`) and choose from 3 AI-generated options.
