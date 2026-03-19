/**
 * Audience Inference Engine - Infers audience persona from creator and post data
 * Sprint 2: Discovery & Audience Inference
 */

// Professional role patterns for classification
const ROLE_PATTERNS = {
    'C-Suite': ['ceo', 'cto', 'cfo', 'coo', 'cio', 'chief', 'president', 'founder', 'co-founder'],
    'VP/Director': ['vp', 'vice president', 'director', 'head of', 'svp', 'evp'],
    'Manager': ['manager', 'lead', 'supervisor', 'team lead'],
    'Engineer': ['engineer', 'developer', 'architect', 'data scientist', 'ml engineer'],
    'Clinician': ['md', 'doctor', 'physician', 'nurse', 'clinical', 'surgeon', 'np', 'pa'],
    'Investor': ['partner', 'investor', 'vc', 'venture', 'principal', 'associate'],
    'Consultant': ['consultant', 'advisor', 'strategist', 'analyst']
};

// Industry patterns
const INDUSTRY_PATTERNS = {
    'Healthtech': ['health', 'healthcare', 'medical', 'clinical', 'hospital', 'patient'],
    'AI/ML': ['ai', 'artificial intelligence', 'machine learning', 'ml', 'deep learning'],
    'SaaS': ['saas', 'software', 'platform', 'cloud'],
    'Fintech': ['fintech', 'financial', 'banking', 'payments'],
    'Enterprise': ['enterprise', 'b2b', 'business'],
    'Consumer': ['consumer', 'b2c', 'retail', 'e-commerce']
};

// Content style indicators
const STYLE_INDICATORS = {
    technical: ['api', 'algorithm', 'deploy', 'integration', 'architecture', 'stack', 'framework'],
    business: ['roi', 'revenue', 'growth', 'scale', 'market', 'customer', 'strategy'],
    thought_leadership: ['believe', 'future', 'vision', 'transform', 'change', 'industry'],
    personal: ['i learned', 'my journey', 'story', 'experience', 'lesson', 'mistake'],
    educational: ['how to', 'guide', 'tips', 'steps', 'framework', 'checklist']
};

// Tone indicators
const TONE_INDICATORS = {
    formal: ['furthermore', 'therefore', 'consequently', 'accordingly', 'hereby'],
    casual: ['honestly', 'btw', 'lol', 'tbh', 'love', 'amazing', 'crazy'],
    technical: ['implementation', 'architecture', 'infrastructure', 'deployment'],
    inspirational: ['dream', 'believe', 'achieve', 'passion', 'purpose', 'mission']
};

/**
 * Infer professional role from headline
 */
function inferProfessionalRole(headline) {
    if (!headline) return 'Professional';

    const normalized = headline.toLowerCase();

    for (const [role, patterns] of Object.entries(ROLE_PATTERNS)) {
        if (patterns.some(p => normalized.includes(p))) {
            return role;
        }
    }

    return 'Professional';
}

/**
 * Infer industry from headline and post content
 */
function inferIndustry(headline, postText) {
    const combined = ((headline || '') + ' ' + (postText || '')).toLowerCase();
    const matches = [];

    for (const [industry, patterns] of Object.entries(INDUSTRY_PATTERNS)) {
        const matchCount = patterns.filter(p => combined.includes(p)).length;
        if (matchCount > 0) {
            matches.push({ industry, score: matchCount });
        }
    }

    matches.sort((a, b) => b.score - a.score);
    return matches.length > 0 ? matches[0].industry : 'General Business';
}

/**
 * Analyze content style
 */
function analyzeContentStyle(postText) {
    if (!postText) return ['general'];

    const normalized = postText.toLowerCase();
    const styles = [];

    for (const [style, indicators] of Object.entries(STYLE_INDICATORS)) {
        const matchCount = indicators.filter(i => normalized.includes(i)).length;
        if (matchCount >= 2) {
            styles.push(style);
        }
    }

    return styles.length > 0 ? styles : ['general'];
}

/**
 * Analyze writing tone
 */
function analyzeTone(postText) {
    if (!postText) return 'neutral';

    const normalized = postText.toLowerCase();
    let maxScore = 0;
    let dominantTone = 'neutral';

    for (const [tone, indicators] of Object.entries(TONE_INDICATORS)) {
        const matchCount = indicators.filter(i => normalized.includes(i)).length;
        if (matchCount > maxScore) {
            maxScore = matchCount;
            dominantTone = tone;
        }
    }

    return dominantTone;
}

/**
 * Estimate audience size from engagement
 */
function estimateAudienceSize(engagement) {
    const total = (engagement?.reactions || 0) + (engagement?.comments || 0);

    if (total >= 1000) return '50K+';
    if (total >= 500) return '10K-50K';
    if (total >= 100) return '5K-10K';
    if (total >= 50) return '1K-5K';
    return '<1K';
}

/**
 * Extract key topics from post text and hashtags
 */
function extractKeyTopics(postText, hashtags) {
    const topics = new Set();

    // Add hashtags as topics
    (hashtags || []).forEach(tag => {
        const clean = tag.replace('#', '').toLowerCase();
        topics.add(clean);
    });

    // Extract common topic keywords from text
    const topicKeywords = [
        'ai', 'automation', 'healthcare', 'leadership', 'growth', 'startup',
        'revenue cycle', 'prior auth', 'voice ai', 'ambient ai', 'digital health',
        'fitness', 'discipline', 'founder', 'engineering', 'product'
    ];

    const normalized = (postText || '').toLowerCase();
    topicKeywords.forEach(kw => {
        if (normalized.includes(kw)) {
            topics.add(kw);
        }
    });

    return Array.from(topics).slice(0, 8);
}

/**
 * Recommend comment tone based on audience profile
 */
function recommendTone(audienceProfile) {
    const { professionalRole, contentStyle, industry } = audienceProfile;

    // C-Suite and executives prefer concise, value-focused comments
    if (professionalRole === 'C-Suite' || professionalRole === 'VP/Director') {
        return 'Professional with business insight';
    }

    // Technical roles appreciate detailed, specific comments
    if (professionalRole === 'Engineer' || contentStyle.includes('technical')) {
        return 'Technical with practical examples';
    }

    // Clinicians value clinical evidence and real-world impact
    if (professionalRole === 'Clinician') {
        return 'Evidence-based with patient impact focus';
    }

    // Investors want market and growth perspectives
    if (professionalRole === 'Investor') {
        return 'Strategic with market insight';
    }

    // Healthtech-specific
    if (industry === 'Healthtech') {
        return 'Operator insight with healthcare context';
    }

    return 'Professional with authentic perspective';
}

/**
 * Suggest comment strategies based on audience
 */
function suggestCommentStrategies(audienceProfile) {
    const strategies = [];

    // Based on content style
    if (audienceProfile.contentStyle.includes('thought_leadership')) {
        strategies.push({
            type: 'Contrarian Respectful',
            description: 'Challenge the point with nuance and respect'
        });
    }

    if (audienceProfile.contentStyle.includes('educational')) {
        strategies.push({
            type: 'Micro-Framework',
            description: 'Add your own 3-step model or checklist'
        });
    }

    if (audienceProfile.contentStyle.includes('personal')) {
        strategies.push({
            type: 'Story-Based',
            description: 'Share a related personal anecdote'
        });
    }

    // Always include operator insight for business contexts
    if (audienceProfile.industry !== 'General Business') {
        strategies.push({
            type: 'Operator Insight',
            description: 'Share practical experience from your work'
        });
    }

    // Add question hook as default
    strategies.push({
        type: 'Question Hook',
        description: 'End with a thoughtful follow-up question'
    });

    return strategies;
}

/**
 * Main audience inference function
 * Returns a complete audience profile
 */
function inferAudience(creatorData, postData) {
    const headline = creatorData?.authorHeadline || postData?.authorHeadline || '';
    const postText = postData?.text || '';
    const hashtags = postData?.hashtags || [];
    const engagement = postData?.engagement || {};

    const professionalRole = inferProfessionalRole(headline);
    const industry = inferIndustry(headline, postText);
    const contentStyle = analyzeContentStyle(postText);
    const tone = analyzeTone(postText);
    const audienceSize = estimateAudienceSize(engagement);
    const keyTopics = extractKeyTopics(postText, hashtags);

    const profile = {
        // Demographics
        professionalRole,
        industry,
        audienceSize,

        // Psychographics
        contentStyle,
        writingTone: tone,
        keyTopics,

        // Recommendations
        recommendedTone: '',
        commentStrategies: []
    };

    // Generate recommendations
    profile.recommendedTone = recommendTone(profile);
    profile.commentStrategies = suggestCommentStrategies(profile);

    return profile;
}

/**
 * Generate a subtle audience perspective tailor for the system prompt
 * This is a concise string that helps the LLM think about the specific audience
 * without overwhelming the prompt with detailed context
 */
function getAudiencePerspective(audienceProfile) {
    const { professionalRole, industry, recommendedTone } = audienceProfile;

    // Build a natural, conversational perspective string
    let perspective = '';

    // Add professional role context
    if (professionalRole && professionalRole !== 'Professional') {
        perspective += `You're engaging with a ${professionalRole}`;
    } else {
        perspective += `You're engaging with a professional`;
    }

    // Add industry context if specific
    if (industry && industry !== 'General Business') {
        perspective += ` in ${industry}`;
    }

    // Add tone guidance
    if (recommendedTone) {
        perspective += `. Use a ${recommendedTone.toLowerCase()} approach`;
    }

    perspective += '.';

    return perspective;
}

/**
 * Get comment angle suggestions based on audience
 * Returns structured angles from commenting-plan.md approach
 */
function getCommentAngles(audienceProfile) {
    return {
        operator: {
            label: 'Operator Insight',
            prompt: `Share practical experience related to ${audienceProfile.keyTopics.slice(0, 3).join(', ')}. Propose a framework and ask a specific question.`
        },
        contrarian: {
            label: 'Respectful Contrarian',
            prompt: `Challenge an assumption with nuance. Acknowledge the point, then offer an alternative perspective with evidence.`
        },
        framework: {
            label: 'Micro-Framework',
            prompt: `Offer a 3-step model that builds on the post. Example: "My approach: 1) Identify, 2) Automate, 3) Measure."`
        },
        story: {
            label: 'Story-Based',
            prompt: `Share a brief anecdote that illustrates the point. Keep it to 2-3 sentences and connect back to their message.`
        },
        question: {
            label: 'Question Hook',
            prompt: `Ask a thoughtful follow-up question that extends the discussion. Make it specific to their expertise.`
        }
    };
}

// Export for use in extension
if (typeof window !== 'undefined') {
    window.AudienceInference = {
        inferAudience,
        inferProfessionalRole,
        inferIndustry,
        analyzeContentStyle,
        analyzeTone,
        estimateAudienceSize,
        extractKeyTopics,
        recommendTone,
        suggestCommentStrategies,
        getAudiencePerspective,
        getCommentAngles
    };
}
