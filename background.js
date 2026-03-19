// Background service worker for Gemini Comment Generator
// Handles keyboard shortcuts, batch API calls, side panel, and message routing

// Log when the extension is installed or updated
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        console.log('Gemini Comment Generator installed! Click icon or Ctrl+Q to open side panel.');
    } else if (details.reason === 'update') {
        console.log('Gemini Comment Generator updated to version ' + chrome.runtime.getManifest().version);
    }

    // Enable the side panel to be opened by clicking the extension icon
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

// Handle clicking the extension icon - open side panel
chrome.action.onClicked.addListener((tab) => {
    chrome.sidePanel.open({ tabId: tab.id });
});

// Handle the Ctrl+Q command - open side panel
chrome.commands.onCommand.addListener(async (command) => {
    if (command === '_execute_action') {
        console.log('Ctrl+Q pressed - opening side panel');
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
            chrome.sidePanel.open({ tabId: tab.id });
        }
    }
});

/**
 * Get API settings from storage
 */
async function getApiSettings() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['apiKey', 'selectedModel', 'systemPrompt'], (result) => {
            resolve({
                apiKey: result.apiKey || '',
                model: result.selectedModel || 'gemini-3-flash-preview',
                systemPrompt: result.systemPrompt || ''
            });
        });
    });
}

/**
 * Build smart audience-aware prompt for comment generation
 */
function buildSmartPromptForBackground(post, audienceProfile) {
    const postContent = post.text || post.preview || '';
    const authorName = post.author || 'the author';
    const authorHeadline = post.authorHeadline || '';

    // Build subtle audience perspective
    let audiencePerspective = `You're engaging with a ${audienceProfile.professionalRole || 'professional'}`;
    if (audienceProfile.industry && audienceProfile.industry !== 'General Business') {
        audiencePerspective += ` in ${audienceProfile.industry}`;
    }
    if (audienceProfile.recommendedTone) {
        audiencePerspective += `. Use a ${audienceProfile.recommendedTone.toLowerCase()} approach`;
    }
    audiencePerspective += '.\n\n';

    return `${audiencePerspective}Act as a professional social media expert. Generate 3 thoughtful LinkedIn comments based on the provided post. Make the comments engaging, authentic, and likely to generate meaningful discussion. Vary the tone: one using strong ethos/logos/pathos and the concepts of difference - novelty - fear - or attraction, one questioning/curious, and one trolling. Be concise (2 sentences max) and punchy, and use simple language. Like 6th grade level.

POST: ${postContent}
AUTHOR: ${authorName}${authorHeadline ? ` • ${authorHeadline}` : ''}

Return ONLY 3 comments, numbered 1-3.`;
}

/**
 * Generate comments for a single post using Gemini API
 * Supports audience-aware prompts when audienceProfile is provided
 */
async function generateCommentsForPost(postData, settings) {
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${settings.model}:generateContent?key=${settings.apiKey}`;

    // Build prompt based on whether we have audience data
    let prompt;
    if (postData.audienceProfile) {
        // Use smart audience-aware prompt
        prompt = buildSmartPromptForBackground(postData, postData.audienceProfile);
    } else {
        // Fallback to basic prompt
        prompt = settings.systemPrompt || 'Generate 3 thoughtful, engaging comments for the following LinkedIn post:';
        prompt += `\n\nPost by ${postData.author || 'Author'}:\n"${postData.text}"`;
    }

    const payload = {
        contents: [{
            parts: [{ text: prompt }]
        }],
        generationConfig: {
            response_mime_type: "application/json",
            response_schema: {
                type: "object",
                properties: {
                    comments: {
                        type: "array",
                        items: { type: "string" }
                    }
                },
                required: ["comments"]
            }
        }
    };

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorBody = await response.json();
            throw new Error(errorBody.error?.message || 'API request failed');
        }

        const data = await response.json();
        const responseText = data.candidates[0].content.parts[0].text;
        const jsonResponse = JSON.parse(responseText);

        return {
            success: true,
            comments: jsonResponse.comments || []
        };
    } catch (error) {
        console.error('Error generating comments:', error);
        return {
            success: false,
            error: error.message,
            comments: []
        };
    }
}

/**
 * Generate comments for multiple posts in batch (parallelized)
 * Processes posts in batches of 3 for faster generation
 */
async function generateBatchComments(posts, tabId = null) {
    const settings = await getApiSettings();

    if (!settings.apiKey) {
        return { success: false, error: 'API key not set', results: [] };
    }

    const BATCH_SIZE = 3; // Process 3 posts concurrently
    const results = [];
    const totalPosts = posts.length;

    for (let i = 0; i < totalPosts; i += BATCH_SIZE) {
        const batch = posts.slice(i, i + BATCH_SIZE);

        // Process batch in parallel
        const batchPromises = batch.map(async (post) => {
            const result = await generateCommentsForPost(post, settings);
            return {
                postId: post.id,
                postIndex: post.index,
                ...result
            };
        });

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);

        // Report progress to popup
        const completed = Math.min(i + BATCH_SIZE, totalPosts);
        if (tabId) {
            try {
                chrome.runtime.sendMessage({
                    action: 'batchProgress',
                    completed,
                    total: totalPosts
                });
            } catch (e) {
                // Ignore if popup closed
            }
        }

        // Small delay between batches to avoid rate limiting
        if (i + BATCH_SIZE < totalPosts) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    return { success: true, results };
}

// Handle messages from popup and content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Background received message:', request.action);

    switch (request.action) {
        case 'generateBatchComments':
            generateBatchComments(request.posts)
                .then(result => sendResponse(result));
            return true; // Keep channel open for async response

        case 'generateSingleComment':
            getApiSettings().then(settings => {
                generateCommentsForPost(request.text, request.author || 'Author', settings)
                    .then(result => sendResponse(result));
            });
            return true;

        case 'getApiSettings':
            getApiSettings().then(settings => sendResponse(settings));
            return true;

        default:
            sendResponse({ success: false, message: 'Unknown action' });
    }
});
