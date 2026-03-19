/**
 * A/B Testing Framework
 * Sprint 4: Analytics & A/B Testing
 * 
 * Manages test configurations, variant assignment, and result analysis
 */

// Active A/B test configurations
const AB_TESTS = {
    commentStyle: {
        id: 'comment-style-v1',
        name: 'Comment Style Test',
        variants: ['operator', 'framework', 'question'],
        description: 'Testing which comment style generates most engagement',
        active: true
    },
    commentLength: {
        id: 'comment-length-v1',
        name: 'Comment Length Test',
        variants: ['short', 'medium', 'long'], // <150, 150-300, 300+
        description: 'Testing optimal comment length for engagement',
        active: false
    },
    openingType: {
        id: 'opening-type-v1',
        name: 'Opening Type Test',
        variants: ['agreement', 'challenge', 'question', 'story'],
        description: 'Testing which opening approach works best',
        active: false
    }
};

// Length thresholds
const LENGTH_THRESHOLDS = {
    short: 150,
    medium: 300
};

/**
 * Simple hash function for deterministic variant assignment
 */
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
}

/**
 * Assign a variant to a post based on post ID (deterministic)
 */
function assignVariant(postId, testId) {
    const test = Object.values(AB_TESTS).find(t => t.id === testId);
    if (!test || !test.active) return null;

    const hash = simpleHash(postId + testId);
    return test.variants[hash % test.variants.length];
}

/**
 * Get all active tests
 */
function getActiveTests() {
    return Object.entries(AB_TESTS)
        .filter(([_, test]) => test.active)
        .map(([key, test]) => ({ key, ...test }));
}

/**
 * Categorize comment length
 */
function categorizeLength(charCount) {
    if (charCount < LENGTH_THRESHOLDS.short) return 'short';
    if (charCount < LENGTH_THRESHOLDS.medium) return 'medium';
    return 'long';
}

/**
 * Record a comment with its variant assignment
 */
async function recordVariantAssignment(commentId, testId, variant, metadata = {}) {
    return new Promise(resolve => {
        chrome.storage.local.get(['abTestResults'], (result) => {
            const results = result.abTestResults || {};

            if (!results[testId]) {
                results[testId] = { variants: {} };
            }

            if (!results[testId].variants[variant]) {
                results[testId].variants[variant] = {
                    count: 0,
                    totalReactions: 0,
                    totalReplies: 0,
                    comments: []
                };
            }

            results[testId].variants[variant].count++;
            results[testId].variants[variant].comments.push({
                commentId,
                timestamp: new Date().toISOString(),
                ...metadata
            });

            chrome.storage.local.set({ abTestResults: results }, () => {
                resolve(results[testId].variants[variant]);
            });
        });
    });
}

/**
 * Update engagement data for a comment
 */
async function updateVariantEngagement(testId, variant, reactions, replies) {
    return new Promise(resolve => {
        chrome.storage.local.get(['abTestResults'], (result) => {
            const results = result.abTestResults || {};

            if (results[testId]?.variants?.[variant]) {
                results[testId].variants[variant].totalReactions += reactions;
                results[testId].variants[variant].totalReplies += replies;
            }

            chrome.storage.local.set({ abTestResults: results }, () => {
                resolve(results[testId]?.variants?.[variant]);
            });
        });
    });
}

/**
 * Analyze A/B test results
 */
async function analyzeTest(testId) {
    return new Promise(resolve => {
        chrome.storage.local.get(['abTestResults'], (result) => {
            const testResults = result.abTestResults?.[testId];

            if (!testResults) {
                resolve({ error: 'No data for this test' });
                return;
            }

            const variants = Object.entries(testResults.variants).map(([name, data]) => {
                const engagementRate = data.count > 0
                    ? (data.totalReactions + data.totalReplies * 2) / data.count
                    : 0;

                return {
                    name,
                    n: data.count,
                    reactions: data.totalReactions,
                    replies: data.totalReplies,
                    engagementRate: Math.round(engagementRate * 100) / 100
                };
            });

            // Sort by engagement rate
            variants.sort((a, b) => b.engagementRate - a.engagementRate);

            // Determine winner (need min sample size)
            const minSampleSize = 10;
            const qualifiedVariants = variants.filter(v => v.n >= minSampleSize);

            let winner = null;
            let confidence = 0;
            let recommendation = 'Keep collecting data';

            if (qualifiedVariants.length >= 2) {
                winner = qualifiedVariants[0].name;
                // Simple confidence calculation (placeholder for proper stats)
                const diff = qualifiedVariants[0].engagementRate - qualifiedVariants[1].engagementRate;
                confidence = Math.min(0.95, 0.5 + (diff * 2));

                if (confidence > 0.8) {
                    recommendation = `Use "${winner}" style - ${Math.round(confidence * 100)}% confidence`;
                }
            }

            resolve({
                testId,
                variants,
                totalSamples: variants.reduce((sum, v) => sum + v.n, 0),
                winner,
                confidence: Math.round(confidence * 100) / 100,
                recommendation
            });
        });
    });
}

/**
 * Get summary of all tests
 */
async function getAllTestResults() {
    return new Promise(resolve => {
        chrome.storage.local.get(['abTestResults'], async (result) => {
            const results = result.abTestResults || {};
            const analyses = [];

            for (const testId of Object.keys(results)) {
                const analysis = await analyzeTest(testId);
                analyses.push(analysis);
            }

            resolve(analyses);
        });
    });
}

/**
 * Reset test data
 */
async function resetTest(testId) {
    return new Promise(resolve => {
        chrome.storage.local.get(['abTestResults'], (result) => {
            const results = result.abTestResults || {};
            delete results[testId];
            chrome.storage.local.set({ abTestResults: results }, () => {
                resolve(true);
            });
        });
    });
}

// Export for use in extension
if (typeof window !== 'undefined') {
    window.ABTesting = {
        AB_TESTS,
        simpleHash,
        assignVariant,
        getActiveTests,
        categorizeLength,
        recordVariantAssignment,
        updateVariantEngagement,
        analyzeTest,
        getAllTestResults,
        resetTest
    };
}
