/**
 * Audience-Aware Prompt Builder
 * Sprint 3: Smart Comment Generation
 * 
 * Generates tailored prompts based on audience profile
 */

// Comment style templates with specific instructions
const COMMENT_STYLES = {
    operator: {
        name: 'Operator Insight',
        description: 'Share practical experience from your work',
        prompt: `Write as someone who has actually done this work. Share a specific insight, metric, or lesson learned. Be concrete, not abstract. Reference a real workflow or process.`
    },
    contrarian: {
        name: 'Respectful Contrarian',
        description: 'Challenge the point with nuance',
        prompt: `Respectfully challenge one assumption in the post. Acknowledge what's good, then offer an alternative perspective with a brief reason. Keep it curious, not combative.`
    },
    framework: {
        name: 'Micro-Framework',
        description: 'Offer a 3-step model',
        prompt: `Share a simple 3-step framework that builds on their point. Format as: "My approach: 1) Step, 2) Step, 3) Step." Keep each step to a few words.`
    },
    story: {
        name: 'Story-Based',
        description: 'Brief relatable anecdote',
        prompt: `Share a 2-3 sentence story that illustrates their point. Start with a specific moment ("Last week...", "I once..."). Connect it back to their message.`
    },
    question: {
        name: 'Question Hook',
        description: 'Thoughtful follow-up question',
        prompt: `Ask a specific, thoughtful question that extends the conversation. It should show you understood the post and make the author want to respond.`
    }
};

// Tone modifiers based on audience
const TONE_MODIFIERS = {
    'C-Suite': 'Use executive-level language. Be concise. Focus on ROI, scale, and strategic impact.',
    'VP/Director': 'Balance strategy with execution details. Reference cross-functional coordination.',
    'Manager': 'Focus on practical implementation. Reference team dynamics and day-to-day challenges.',
    'Engineer': 'Be specific and technical when relevant. Reference tools, systems, or methodologies.',
    'Clinician': 'Acknowledge clinical workflow realities. Reference patient impact and evidence.',
    'Investor': 'Frame insights around market trends, growth potential, and differentiation.',
    'Consultant': 'Reference frameworks and client scenarios. Be insight-dense.',
    'Professional': 'Keep it accessible and relatable. Focus on universal business themes.'
};

// Industry context additions
const INDUSTRY_CONTEXT = {
    'Healthtech': 'Reference healthcare-specific challenges like compliance, patient outcomes, or revenue cycle.',
    'AI/ML': 'Reference practical AI implementation, not hype. Be specific about use cases.',
    'SaaS': 'Reference product, growth, or customer success metrics where relevant.',
    'Fintech': 'Reference regulatory or trust considerations where relevant.',
    'Enterprise': 'Reference procurement, integration, or change management realities.',
    'General Business': 'Keep insights broadly applicable.'
};

/**
 * Build the complete prompt for generating comments
 */
function buildAudienceAwarePrompt(post, audienceProfile, selectedStyles = ['operator', 'framework', 'question']) {
    const postContent = post.text || post.preview || '';
    const authorName = post.author || 'the author';
    const authorHeadline = post.authorHeadline || '';

    // Get subtle audience perspective to prepend to the system prompt
    let audiencePerspective = '';
    if (typeof window !== 'undefined' && window.AudienceInference && window.AudienceInference.getAudiencePerspective) {
        audiencePerspective = window.AudienceInference.getAudiencePerspective(audienceProfile) + '\n\n';
    } else {
        // Fallback if AudienceInference is not available
        audiencePerspective = `You're engaging with a ${audienceProfile.professionalRole || 'professional'}` +
            (audienceProfile.industry && audienceProfile.industry !== 'General Business' ? ` in ${audienceProfile.industry}` : '') +
            `.\n\n`;
    }

    // Build the complete prompt with audience perspective at the beginning
    const prompt = `${audiencePerspective}Act as a professional social media expert. Generate 3 thoughtful LinkedIn comments based on the provided post. Make the comments engaging, authentic, and likely to generate meaningful discussion. Vary the tone: one using strong ethos/logos/pathos and the concepts of difference - novelty - fear - or attraction, one questioning/curious, and one trolling. Be concise (2 sentences max) and punchy, and use simple language. Like 6th grade level.

---
POST CONTENT:
${postContent}

AUTHOR: ${authorName}${authorHeadline ? ` • ${authorHeadline}` : ''}
---

OUTPUT FORMAT:
Return ONLY the 3 comments, numbered 1-3, one per line.`;

    return prompt;
}

/**
 * Select optimal comment styles based on post characteristics
 */
function selectCommentStyles(post, audienceProfile) {
    const styles = [];
    const contentStyle = audienceProfile.contentStyle || [];

    // Always include operator insight for business/tech
    styles.push('operator');

    // Add framework for how-to or strategy content
    if (contentStyle.includes('educational') || contentStyle.includes('business')) {
        styles.push('framework');
    }

    // Add contrarian for thought leadership
    if (contentStyle.includes('thought_leadership')) {
        styles.push('contrarian');
    }

    // Add story for personal content
    if (contentStyle.includes('personal')) {
        styles.push('story');
    }

    // Always include question for engagement
    if (!styles.includes('question') && styles.length < 3) {
        styles.push('question');
    }

    // Limit to 3 styles
    return styles.slice(0, 3);
}

/**
 * Build prompt with automatic style selection
 */
function buildSmartPrompt(post, audienceProfile) {
    const selectedStyles = selectCommentStyles(post, audienceProfile);
    return {
        prompt: buildAudienceAwarePrompt(post, audienceProfile, selectedStyles),
        styles: selectedStyles.map(s => COMMENT_STYLES[s])
    };
}

/**
 * Get all available comment styles
 */
function getAvailableStyles() {
    return Object.entries(COMMENT_STYLES).map(([key, value]) => ({
        key,
        ...value
    }));
}

// Daily limit management
let dailyCommentCount = 0;
let dailyLimitResetDate = null;

/**
 * Check and update daily comment count
 */
async function checkDailyLimit(limit = 20) {
    const today = new Date().toDateString();

    return new Promise(resolve => {
        chrome.storage.local.get(['dailyCommentCount', 'dailyLimitResetDate'], (result) => {
            // Reset if new day
            if (result.dailyLimitResetDate !== today) {
                chrome.storage.local.set({
                    dailyCommentCount: 0,
                    dailyLimitResetDate: today
                });
                dailyCommentCount = 0;
                dailyLimitResetDate = today;
            } else {
                dailyCommentCount = result.dailyCommentCount || 0;
                dailyLimitResetDate = result.dailyLimitResetDate;
            }

            resolve({
                count: dailyCommentCount,
                limit: limit,
                remaining: Math.max(0, limit - dailyCommentCount),
                canComment: dailyCommentCount < limit
            });
        });
    });
}

/**
 * Increment daily comment count
 */
async function incrementDailyCount() {
    return new Promise(resolve => {
        chrome.storage.local.get(['dailyCommentCount'], (result) => {
            const newCount = (result.dailyCommentCount || 0) + 1;
            chrome.storage.local.set({ dailyCommentCount: newCount }, () => {
                dailyCommentCount = newCount;
                resolve(newCount);
            });
        });
    });
}

// Export for use in other scripts
if (typeof window !== 'undefined') {
    window.SmartPrompts = {
        COMMENT_STYLES,
        TONE_MODIFIERS,
        INDUSTRY_CONTEXT,
        buildAudienceAwarePrompt,
        buildSmartPrompt,
        selectCommentStyles,
        getAvailableStyles,
        checkDailyLimit,
        incrementDailyCount
    };
}
