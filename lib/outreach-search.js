/**
 * Outreach Search Engine
 * Sprint 5: Automated creator discovery and watchlist generation
 * 
 * Uses Gemini API to search for power creators in target niches
 */

/**
 * Search for power creators in a target niche using Gemini
 */
async function searchPowerCreators(niche, count = 25) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(['geminiApiKey'], async (result) => {
            const apiKey = result.geminiApiKey;

            if (!apiKey) {
                reject(new Error('Gemini API key not configured'));
                return;
            }

            const prompt = buildCreatorSearchPrompt(niche, count);

            try {
                const response = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{ parts: [{ text: prompt }] }],
                            generationConfig: {
                                temperature: 0.7,
                                maxOutputTokens: 4096
                            }
                        })
                    }
                );

                if (!response.ok) {
                    throw new Error(`Gemini API error: ${response.status}`);
                }

                const data = await response.json();
                const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

                if (!text) {
                    throw new Error('Empty response from Gemini');
                }

                // Extract JSON from response
                const creators = parseCreatorResponse(text);
                resolve(creators);

            } catch (error) {
                reject(error);
            }
        });
    });
}

/**
 * Build the prompt for creator search
 */
function buildCreatorSearchPrompt(niche, count) {
    return `You are a LinkedIn creator researcher and social media analyst.

I need you to identify the top ${count} power creators on LinkedIn in the "${niche}" space.

For each creator, provide:
1. Full name
2. Current role and company
3. Key themes they post about (3-5 topics)
4. Estimated engagement level: "High" (10K+ reactions typical), "Medium" (1K-10K), or "Low" (<1K)
5. Posting frequency: "Daily", "Weekly", or "Monthly"
6. Why they're influential in this space
7. Best comment angles to engage with them:
   - operator: Practical, metrics-driven insight to share
   - contrarian: Respectful challenge or alternative view
   - framework: 3-step actionable approach
   - story: Brief personal anecdote angle
   - question: Thoughtful follow-up question

Return ONLY valid JSON in this exact format:
{
  "niche": "${niche}",
  "searchedAt": "${new Date().toISOString()}",
  "creators": [
    {
      "rank": 1,
      "name": "Full Name",
      "role": "Job Title",
      "company": "Company Name",
      "themes": ["Theme 1", "Theme 2", "Theme 3"],
      "engagement": "High",
      "frequency": "Weekly",
      "influence": "Brief explanation of why they're influential",
      "commentAngles": {
        "operator": "Specific operator insight angle",
        "contrarian": "Specific contrarian angle",
        "framework": "Specific framework angle",
        "story": "Specific story angle",
        "question": "Specific question to ask"
      },
      "score": 24
    }
  ]
}

Important:
- Rank by influence and engagement in this specific niche
- Score from 15-25 based on influence (25 = most influential)
- Focus on creators who actively post and engage
- Include a mix of founders, executives, investors, and thought leaders
- Ensure all names are real LinkedIn creators known in this space`;
}

/**
 * Parse the Gemini response to extract creator data
 */
function parseCreatorResponse(text) {
    try {
        // Try to extract JSON from the response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            return parsed;
        }
    } catch (e) {
        console.error('Failed to parse creator response:', e);
    }

    // Return empty structure if parsing fails
    return {
        niche: 'unknown',
        searchedAt: new Date().toISOString(),
        creators: [],
        error: 'Failed to parse response'
    };
}

/**
 * Score and rank creators
 */
function rankCreators(creators) {
    return creators.sort((a, b) => b.score - a.score).map((c, i) => ({
        ...c,
        rank: i + 1
    }));
}

/**
 * Convert creators to watchlist format compatible with discovery.js
 */
function convertToWatchlistFormat(creatorData) {
    return creatorData.creators.map(c => ({
        rank: c.rank,
        name: c.name,
        company: c.company,
        score: c.score,
        themes: c.themes,
        role: c.role,
        commentAngles: c.commentAngles
    }));
}

/**
 * Save outreach plan to storage
 */
async function saveOutreachPlan(planData) {
    return new Promise(resolve => {
        chrome.storage.local.get(['outreachPlans'], (result) => {
            const plans = result.outreachPlans || [];

            const newPlan = {
                id: `plan-${Date.now()}`,
                ...planData,
                savedAt: new Date().toISOString()
            };

            plans.unshift(newPlan);

            // Keep only last 10 plans
            const trimmed = plans.slice(0, 10);

            chrome.storage.local.set({ outreachPlans: trimmed }, () => {
                resolve(newPlan);
            });
        });
    });
}

/**
 * Get saved outreach plans
 */
async function getOutreachPlans() {
    return new Promise(resolve => {
        chrome.storage.local.get(['outreachPlans'], (result) => {
            resolve(result.outreachPlans || []);
        });
    });
}

/**
 * Apply an outreach plan to the discovery watchlist
 */
async function applyPlanToWatchlist(planId) {
    return new Promise(resolve => {
        chrome.storage.local.get(['outreachPlans', 'customWatchlist'], (result) => {
            const plans = result.outreachPlans || [];
            const plan = plans.find(p => p.id === planId);

            if (!plan) {
                resolve({ success: false, error: 'Plan not found' });
                return;
            }

            const watchlist = convertToWatchlistFormat(plan);

            chrome.storage.local.set({ customWatchlist: watchlist }, () => {
                resolve({ success: true, watchlist });
            });
        });
    });
}

/**
 * Get current custom watchlist
 */
async function getCustomWatchlist() {
    return new Promise(resolve => {
        chrome.storage.local.get(['customWatchlist'], (result) => {
            resolve(result.customWatchlist || []);
        });
    });
}

/**
 * Export plan as markdown
 */
function exportPlanAsMarkdown(planData) {
    let md = `# ${planData.niche} - Creator Outreach Plan\n\n`;
    md += `Generated: ${new Date(planData.searchedAt).toLocaleString()}\n\n`;
    md += `## Top 10 Watchlist\n\n`;

    planData.creators.slice(0, 10).forEach((c, i) => {
        md += `### ${i + 1}. ${c.name}\n`;
        md += `**${c.role}** at ${c.company}\n\n`;
        md += `**Themes:** ${c.themes.join(', ')}\n\n`;
        md += `**Why:** ${c.influence}\n\n`;
        md += `**Comment Angles:**\n`;
        md += `- 🔧 Operator: ${c.commentAngles.operator}\n`;
        md += `- 🤔 Contrarian: ${c.commentAngles.contrarian}\n`;
        md += `- 📋 Framework: ${c.commentAngles.framework}\n`;
        md += `- 📖 Story: ${c.commentAngles.story}\n`;
        md += `- ❓ Question: ${c.commentAngles.question}\n\n`;
        md += `---\n\n`;
    });

    md += `## Full Ranked Table\n\n`;
    md += `| Rank | Creator | Role | Themes | Score |\n`;
    md += `|------|---------|------|--------|-------|\n`;

    planData.creators.forEach(c => {
        md += `| ${c.rank} | ${c.name} | ${c.role}, ${c.company} | ${c.themes.slice(0, 3).join(', ')} | ${c.score} |\n`;
    });

    return md;
}

// Export for use in extension
if (typeof window !== 'undefined') {
    window.OutreachSearch = {
        searchPowerCreators,
        parseCreatorResponse,
        rankCreators,
        convertToWatchlistFormat,
        saveOutreachPlan,
        getOutreachPlans,
        applyPlanToWatchlist,
        getCustomWatchlist,
        exportPlanAsMarkdown
    };
}
