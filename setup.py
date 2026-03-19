from setuptools import setup, find_packages

setup(
    name="linkedin_scraper",
    version="0.1.0",
    packages=find_packages(),
    install_requires=[
        "playwright>=1.41.0",
        "sqlalchemy>=2.0.0",
        "click>=8.1.0",
        "python-dotenv>=1.0.0",
        "httpx>=0.26.0",
        "rich>=13.7.0",
    ],
    entry_points={
        "console_scripts": [
            "linkedin-scraper=linkedin_scraper.cli:cli",
        ],
    },
    python_requires=">=3.10",
)
