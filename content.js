// Content script for LinkedIn - Scrapes posts and injects comments
// This script runs on linkedin.com pages

(function () {
    'use strict';

    // Debug mode - set to true to see console logs
    const DEBUG = true;
    
    function debugLog(...args) {
        if (DEBUG) console.log('[LinkedIn Commenter]', ...args);
    }

    // LinkedIn DOM selectors (updated for 2025/2026 LinkedIn structure)
    // LinkedIn frequently changes their class names, so we use multiple fallback selectors
    const SELECTORS = {
        // Main feed post containers - comprehensive list for different LinkedIn layouts
        feedPost: [
            // Current LinkedIn feed post wrappers (2025-2026)
            '[data-id^="urn:li:activity"]',
            '[data-urn^="urn:li:activity"]',
            'div[data-urn*="activity"]',
            // Feed shared update containers
            '.feed-shared-update-v2',
            '.feed-shared-update-v2--minimal-padding',
            // Occluded feed items (lazy loaded)
            '.occludable-update',
            // Scaffold finite scroll items
            '.scaffold-finite-scroll__content > div > div[data-id]',
            // Generic post wrapper patterns
            'div.relative[data-urn]',
            // Main feed container children with activity URN
            '.scaffold-finite-scroll__content [data-urn*="urn:li:activity"]'
        ].join(', '),
        // Post text content - multiple patterns for different post types
        postText: [
            '.feed-shared-update-v2__description',
            '.feed-shared-text',
            '.feed-shared-inline-show-more-text',
            '.break-words',
            '.update-components-text',
            // New span-based text containers
            'span[dir="ltr"].break-words',
            'div.feed-shared-text span',
            '.feed-shared-update-v2__commentary span',
            // Fallback to any text in post body
            '.update-components-update-v2__commentary span',
            '.feed-shared-update-v2__description-wrapper span'
        ].join(', '),
        // Author name
        authorName: [
            '.update-components-actor__name span[aria-hidden="true"]',
            '.update-components-actor__name span.hoverable-link-text',
            '.update-components-actor__title span:first-child',
            '.feed-shared-actor__name',
            '.feed-shared-actor__name span',
            'a.app-aware-link span.hoverable-link-text',
            '.update-components-actor__name a span'
        ].join(', '),
        // Author headline/title
        authorHeadline: [
            '.update-components-actor__description',
            '.update-components-actor__meta',
            '.update-components-actor__description span[aria-hidden="true"]',
            '.feed-shared-actor__description',
            '.update-components-actor__subtitle'
        ].join(', '),
        // Author profile link
        authorProfileLink: [
            '.update-components-actor__container-link',
            '.update-components-actor__image a',
            '.feed-shared-actor__container-link',
            'a[data-control-name="actor"]',
            'a.app-aware-link[href*="/in/"]'
        ].join(', '),
        // Engagement metrics - reactions count
        reactionsCount: [
            '.social-details-social-counts__reactions-count',
            '.feed-shared-social-counts__reactions-count',
            '.social-details-social-counts__count-value',
            'button[aria-label*="reaction"] span.social-details-social-counts__reactions-count',
            'span.social-details-social-counts__reactions-count',
            // New patterns
            'button[aria-label*="reactions"] span',
            '.reactions-count'
        ].join(', '),
        // Engagement metrics - comments count
        commentsCount: [
            '.social-details-social-counts__comments',
            '.feed-shared-social-counts__comments',
            'button[aria-label*="comment"] span.social-details-social-counts__comments',
            'button[aria-label*="comments"] span',
            '.social-details-social-activity__content span'
        ].join(', '),
        // Hashtags in post
        hashtags: [
            'a[href*="hashtag"]',
            '.feed-shared-text a[href*="hashtag"]',
            'a.app-aware-link[href*="hashtag"]'
        ].join(', '),
        // Comment button - multiple selectors for different LinkedIn layouts
        commentButton: [
            'button[aria-label*="Comment"]',
            'button[aria-label*="comment"]',
            '.feed-shared-social-action-bar__action-button:nth-child(2)',
            '.social-actions-button[aria-label*="Comment"]',
            'button.comment-button',
            // New patterns
            'button.social-actions-button--comment',
            'li.social-details-social-activity button[aria-label*="omment"]'
        ].join(', '),
        // Comment input field - LinkedIn uses Quill editor or contenteditable
        commentInput: [
            '.ql-editor[data-placeholder]',
            '.comments-comment-box__form .ql-editor',
            '.comments-comment-texteditor .ql-editor',
            '[contenteditable="true"].ql-editor',
            '.editor-content[contenteditable="true"]',
            'div[role="textbox"][contenteditable="true"]',
            '.comments-comment-texteditor div[contenteditable="true"]'
        ].join(', '),
        // Submit comment button
        submitButton: [
            '.comments-comment-box__submit-button',
            'button.comments-comment-box__submit-button',
            '.comments-comment-texteditor__submit-button',
            'button[type="submit"][class*="comment"]',
            '.artdeco-button--primary[type="submit"]',
            'button.comments-comment-box-comment__submit-button'
        ].join(', ')
    };

    // Store scraped posts
    let scrapedPosts = [];

    /**
     * Wait for an element to appear in the DOM
     */
    async function waitForElement(selector, timeout = 3000, parent = document) {
        return new Promise((resolve) => {
            const startTime = Date.now();

            const check = () => {
                const element = parent.querySelector(selector);
                if (element) {
                    resolve(element);
                    return;
                }

                if (Date.now() - startTime > timeout) {
                    resolve(null);
                    return;
                }

                setTimeout(check, 100);
            };

            check();
        });
    }

    /**
     * Generate a unique ID for a post element
     */
    function generatePostId(element, index) {
        const urn = element.getAttribute('data-urn') || '';
        return urn || `post-${index}-${Date.now()}`;
    }

    /**
     * Extract text content from a post (works with obfuscated class names)
     */
    function extractPostText(postElement) {
        let text = '';
        
        // With obfuscated classes, we need to be smarter about text extraction
        // Strategy: Find the main text content by looking for specific patterns
        
        // Method 1: Look for span elements with dir="ltr" (common for post text)
        const ltrSpans = postElement.querySelectorAll('span[dir="ltr"]');
        const textBlocks = [];
        
        ltrSpans.forEach(span => {
            // Skip if inside button, nav, or header elements
            if (span.closest('button') || 
                span.closest('nav') || 
                span.closest('header') ||
                span.closest('[role="navigation"]') ||
                span.closest('[role="button"]')) {
                return;
            }
            
            const content = (span.innerText || span.textContent || '').trim();
            
            // Skip common UI text and very short strings
            if (content.length < 5) return;
            if (/^(Like|Comment|Repost|Send|Share|Follow|Connect|Reply|See more|Load|Show)$/i.test(content)) return;
            if (/^\d+$/.test(content)) return; // Skip pure numbers
            if (/^[\d,]+\s*(reactions?|comments?|reposts?|likes?)$/i.test(content)) return;
            
            // This looks like actual content
            if (content.length > 10) {
                textBlocks.push(content);
            }
        });
        
        // Method 2: If span method didn't work well, try paragraphs and divs with substantial text
        if (textBlocks.join(' ').length < 30) {
            const contentElements = postElement.querySelectorAll('p, div');
            contentElements.forEach(el => {
                // Skip if it's a container with many children (likely a wrapper, not content)
                if (el.children.length > 5) return;
                
                // Skip interactive elements
                if (el.closest('button') || el.closest('nav') || el.closest('header')) return;
                
                const content = (el.innerText || el.textContent || '').trim();
                
                // Look for paragraph-like content
                if (content.length > 30 && content.length < 2000) {
                    // Make sure it's not already captured
                    if (!textBlocks.some(t => t.includes(content) || content.includes(t))) {
                        // Skip if it looks like UI text
                        if (!/^(Like|Comment|Repost|Send|reactions?|comments?)/i.test(content)) {
                            textBlocks.push(content);
                        }
                    }
                }
            });
        }
        
        // Method 3: Last resort - get all text and filter
        if (textBlocks.length === 0) {
            const fullText = postElement.innerText || postElement.textContent || '';
            // Split by newlines and filter
            const lines = fullText.split('\n').map(l => l.trim()).filter(l => {
                if (l.length < 10) return false;
                if (/^(Like|Comment|Repost|Send|Share|Follow|Connect|Reply|See more|more)$/i.test(l)) return false;
                if (/^\d+\s*(reactions?|comments?|reposts?|likes?|views?)$/i.test(l)) return false;
                if (/^•\s*\d+(st|nd|rd|th)?\s*$/i.test(l)) return false;
                return true;
            });
            
            if (lines.length > 0) {
                // Take the longest line as the main content
                const mainContent = lines.sort((a, b) => b.length - a.length)[0];
                if (mainContent && mainContent.length > 20) {
                    textBlocks.push(mainContent);
                }
            }
        }
        
        // Combine and clean up
        text = textBlocks.join(' ').trim();
        
        // Final cleanup
        text = text.replace(/\s+/g, ' ').trim();
        // Remove duplicate phrases that might occur from nested elements
        const words = text.split(' ');
        const seen = new Set();
        const deduped = [];
        for (let i = 0; i < words.length; i++) {
            const phrase = words.slice(i, i + 5).join(' ');
            if (!seen.has(phrase)) {
                deduped.push(words[i]);
                seen.add(phrase);
            }
        }
        text = deduped.join(' ');
        
        return text.substring(0, 1000); // Limit to 1000 chars
    }

    /**
     * Extract author name from a post (works with obfuscated classes)
     */
    function extractAuthor(postElement) {
        // Method 1: Try legacy selectors first
        const authorEl = postElement.querySelector(SELECTORS.authorName);
        if (authorEl) {
            const name = (authorEl.innerText || authorEl.textContent || '').trim().split('\n')[0];
            if (name && name.length > 1 && name.length < 100) return name;
        }
        
        // Method 2: Find profile links and extract name from nearby text
        const profileLinks = postElement.querySelectorAll('a[href*="/in/"]');
        for (const link of profileLinks) {
            // Look for name in the link text or nearby spans
            const linkText = (link.innerText || link.textContent || '').trim();
            // Name is usually short (1-4 words)
            const nameParts = linkText.split('\n')[0].trim();
            if (nameParts && nameParts.length > 1 && nameParts.length < 60 && !nameParts.includes('•')) {
                // Verify it looks like a name (has letters, not just UI text)
                if (/[a-zA-Z]/.test(nameParts) && !/^(Follow|Connect|View|Like|Comment)/i.test(nameParts)) {
                    return nameParts;
                }
            }
            
            // Check for aria-label on images
            const img = link.querySelector('img');
            if (img) {
                const alt = img.getAttribute('alt') || '';
                if (alt && !alt.includes('photo') && alt.length < 60) {
                    return alt.replace(/'s photo/i, '').trim();
                }
            }
        }
        
        // Method 3: Look for the first substantial text that looks like a name
        const spans = postElement.querySelectorAll('span');
        for (const span of Array.from(spans).slice(0, 20)) {
            const text = (span.innerText || span.textContent || '').trim();
            // Names are typically 2-50 chars, contain letters
            if (text.length >= 2 && text.length <= 50 && /^[A-Za-z]/.test(text)) {
                // Skip common UI text
                if (!/^(Like|Comment|Repost|Send|Follow|Connect|View|Share|Reply|See)/i.test(text)) {
                    if (!text.includes('•') && !text.includes('reaction') && !/^\d/.test(text)) {
                        return text.split('\n')[0];
                    }
                }
            }
        }
        
        return 'Unknown Author';
    }

    /**
     * Extract author headline/title from a post (works with obfuscated classes)
     */
    function extractAuthorHeadline(postElement) {
        // Method 1: Try legacy selectors
        const headlineEl = postElement.querySelector(SELECTORS.authorHeadline);
        if (headlineEl) {
            const headline = (headlineEl.innerText || headlineEl.textContent || '').trim().split('\n')[0];
            if (headline && headline.length > 3) return headline;
        }
        
        // Method 2: Look for text patterns that indicate job titles
        // Headlines often contain patterns like "CEO at", "Founder |", "Engineer @"
        const allText = postElement.innerText || '';
        const lines = allText.split('\n').map(l => l.trim()).filter(l => l.length > 5);
        
        for (const line of lines.slice(0, 10)) {
            // Job title patterns
            if (/\b(at|@|CEO|CTO|Founder|Engineer|Manager|Director|VP|Head of|Lead|Developer)\b/i.test(line)) {
                if (line.length < 150 && !line.includes('Like') && !line.includes('Comment')) {
                    return line;
                }
            }
        }
        
        return '';
    }

    /**
     * Extract author profile URL from a post (works with obfuscated classes)
     */
    function extractAuthorProfileUrl(postElement) {
        // Method 1: Try legacy selectors
        const linkEl = postElement.querySelector(SELECTORS.authorProfileLink);
        if (linkEl && linkEl.href) {
            return linkEl.href;
        }
        
        // Method 2: Find first profile link
        const profileLink = postElement.querySelector('a[href*="/in/"]');
        if (profileLink) {
            return profileLink.href;
        }
        
        return '';
    }

    /**
     * Extract engagement metrics (reactions and comments count)
     */
    function extractEngagement(postElement) {
        let reactions = 0;
        let comments = 0;

        // Extract reactions count
        const reactionsEl = postElement.querySelector(SELECTORS.reactionsCount);
        if (reactionsEl) {
            const text = reactionsEl.innerText || reactionsEl.textContent || '';
            reactions = parseEngagementNumber(text);
        }

        // Extract comments count
        const commentsEl = postElement.querySelector(SELECTORS.commentsCount);
        if (commentsEl) {
            const text = commentsEl.innerText || commentsEl.textContent || '';
            // Comments text is often "24 comments"
            const match = text.match(/(\d+)/);
            comments = match ? parseInt(match[1], 10) : 0;
        }

        return { reactions, comments, total: reactions + comments };
    }

    /**
     * Parse engagement numbers (handles "1.2K", "500", etc.)
     */
    function parseEngagementNumber(text) {
        if (!text) return 0;
        text = text.trim().toLowerCase();

        if (text.includes('k')) {
            return Math.round(parseFloat(text) * 1000);
        } else if (text.includes('m')) {
            return Math.round(parseFloat(text) * 1000000);
        }

        const num = parseInt(text.replace(/[^0-9]/g, ''), 10);
        return isNaN(num) ? 0 : num;
    }

    /**
     * Extract hashtags from a post
     */
    function extractHashtags(postElement) {
        const hashtagEls = postElement.querySelectorAll(SELECTORS.hashtags);
        const hashtags = [];

        hashtagEls.forEach(el => {
            const href = el.href || '';
            const match = href.match(/hashtag\/([^/?]+)/);
            if (match) {
                hashtags.push('#' + match[1]);
            } else {
                const text = (el.innerText || el.textContent || '').trim();
                if (text.startsWith('#')) {
                    hashtags.push(text);
                }
            }
        });

        return [...new Set(hashtags)]; // Dedupe
    }

    /**
     * Find post elements using structural detection (LinkedIn now uses obfuscated class names)
     * This approach looks for DOM patterns rather than class names
     */
    function findPostElements() {
        debugLog('Attempting structural post detection...');
        
        // Strategy 1: Look for elements with data-urn containing activity (most reliable)
        let posts = document.querySelectorAll('[data-urn*="urn:li:activity"]');
        if (posts.length > 0) {
            debugLog(`Strategy 1 (data-urn activity): Found ${posts.length} posts`);
            return posts;
        }
        
        // Strategy 2: Look for data-id with activity URN
        posts = document.querySelectorAll('[data-id*="urn:li:activity"]');
        if (posts.length > 0) {
            debugLog(`Strategy 2 (data-id activity): Found ${posts.length} posts`);
            return posts;
        }
        
        // Strategy 3: Find article elements (semantic HTML)
        posts = document.querySelectorAll('article');
        if (posts.length > 0) {
            debugLog(`Strategy 3 (article elements): Found ${posts.length} posts`);
            return posts;
        }
        
        // Strategy 4: Look for elements with role="article" or similar feed item roles
        posts = document.querySelectorAll('[role="article"], [role="listitem"]');
        if (posts.length > 0) {
            debugLog(`Strategy 4 (ARIA roles): Found ${posts.length} posts`);
            return posts;
        }
        
        // Strategy 5: Find by button patterns - posts have Like/Comment/Repost buttons
        // Look for containers that have all three social action buttons
        const allButtons = document.querySelectorAll('button');
        const potentialPosts = new Set();
        
        allButtons.forEach(btn => {
            const label = (btn.getAttribute('aria-label') || btn.innerText || '').toLowerCase();
            if (label.includes('like') || label.includes('comment') || label.includes('repost') || label.includes('send')) {
                // Walk up to find the post container (usually 3-6 levels up)
                let parent = btn.parentElement;
                for (let i = 0; i < 8 && parent; i++) {
                    // Look for a container that seems like a post
                    // Posts typically have substantial height and contain multiple interactive elements
                    if (parent.offsetHeight > 150) {
                        const hasMultipleButtons = parent.querySelectorAll('button').length >= 3;
                        const hasText = parent.innerText && parent.innerText.length > 50;
                        if (hasMultipleButtons && hasText) {
                            potentialPosts.add(parent);
                            break;
                        }
                    }
                    parent = parent.parentElement;
                }
            }
        });
        
        if (potentialPosts.size > 0) {
            debugLog(`Strategy 5 (button pattern): Found ${potentialPosts.size} potential posts`);
            return Array.from(potentialPosts);
        }
        
        // Strategy 6: Look for elements containing profile images followed by text
        // LinkedIn posts have a profile picture, author info, and post content
        const images = document.querySelectorAll('img[src*="profile"], img[alt*="photo"], img[src*="media"]');
        const postCandidates = new Set();
        
        images.forEach(img => {
            // Walk up to find a container that looks like a post
            let parent = img.parentElement;
            for (let i = 0; i < 10 && parent; i++) {
                // Posts are typically substantial in size
                if (parent.offsetHeight > 200 && parent.offsetWidth > 300) {
                    const text = parent.innerText || '';
                    // Posts have reasonable text content
                    if (text.length > 100 && text.length < 10000) {
                        // Check if this looks like a feed post (has reactions/comments area)
                        const hasInteractions = text.toLowerCase().includes('like') || 
                                               text.toLowerCase().includes('comment') ||
                                               text.toLowerCase().includes('repost');
                        if (hasInteractions) {
                            postCandidates.add(parent);
                            break;
                        }
                    }
                }
                parent = parent.parentElement;
            }
        });
        
        if (postCandidates.size > 0) {
            debugLog(`Strategy 6 (image+text pattern): Found ${postCandidates.size} candidates`);
            // Filter to remove nested duplicates
            const filtered = filterNestedElements(Array.from(postCandidates));
            debugLog(`After filtering nested: ${filtered.length} posts`);
            return filtered;
        }
        
        // Strategy 7: Deep DOM scan - find div containers with specific structure
        debugLog('Strategy 7: Deep DOM scan...');
        const deepScanResults = deepScanForPosts();
        if (deepScanResults.length > 0) {
            debugLog(`Strategy 7 (deep scan): Found ${deepScanResults.length} posts`);
            return deepScanResults;
        }
        
        debugLog('All strategies failed to find posts');
        return [];
    }
    
    /**
     * Filter out elements that are nested inside other elements in the array
     */
    function filterNestedElements(elements) {
        return elements.filter(el => {
            return !elements.some(other => other !== el && other.contains(el));
        });
    }
    
    /**
     * Deep scan the DOM for post-like structures
     */
    function deepScanForPosts() {
        const results = [];
        
        // Get the main content area
        const main = document.querySelector('main') || document.body;
        
        // Look for divs that appear to be feed items
        // They typically have: profile link, text content, action buttons
        const allDivs = main.querySelectorAll('div');
        
        for (const div of allDivs) {
            // Skip if too small
            if (div.offsetHeight < 150 || div.offsetWidth < 300) continue;
            
            // Skip if already inside a found post
            if (results.some(r => r.contains(div))) continue;
            
            // Check for post characteristics
            const hasProfileLink = div.querySelector('a[href*="/in/"]') !== null;
            const hasButtons = div.querySelectorAll('button').length >= 2;
            const textContent = div.innerText || '';
            const hasReasonableText = textContent.length > 80 && textContent.length < 8000;
            
            // Check for social interaction indicators
            const hasSocialIndicators = /like|comment|repost|share|reaction/i.test(textContent);
            
            if (hasProfileLink && hasButtons && hasReasonableText && hasSocialIndicators) {
                // Verify this isn't a navigation or sidebar element
                const rect = div.getBoundingClientRect();
                const isInMainArea = rect.left > 100 && rect.width > 400;
                
                if (isInMainArea) {
                    results.push(div);
                    
                    // Limit to prevent performance issues
                    if (results.length >= 30) break;
                }
            }
        }
        
        // Filter nested elements
        return filterNestedElements(results);
    }

    /**
     * Scrape all visible posts from the LinkedIn feed (enhanced with engagement data)
     */
    function scrapePosts() {
        debugLog('Starting post scrape...');
        debugLog('Current URL:', window.location.href);
        
        // Use the new structural detection
        let postElements = findPostElements();
        
        // Also try legacy selectors as backup
        if (postElements.length === 0) {
            debugLog('Structural detection failed, trying legacy class selectors...');
            postElements = document.querySelectorAll(SELECTORS.feedPost);
            debugLog(`Legacy selectors found: ${postElements.length} elements`);
        }
        
        // Debug: Log page structure if nothing found
        if (postElements.length === 0) {
            debugLog('No posts found! Dumping page structure for debugging...');
            const main = document.querySelector('main');
            if (main) {
                debugLog('Main element classes:', main.className);
                debugLog('Main children count:', main.children.length);
                // Log first few element signatures
                Array.from(main.querySelectorAll('*')).slice(0, 20).forEach((el, i) => {
                    if (el.className && typeof el.className === 'string') {
                        debugLog(`  ${i}: ${el.tagName} .${el.className.split(' ').slice(0, 3).join('.')}`);
                    }
                });
            }
            
            // Additional debug - count interactive elements
            const buttons = document.querySelectorAll('button');
            const links = document.querySelectorAll('a[href*="/in/"]');
            debugLog(`Page has ${buttons.length} buttons and ${links.length} profile links`);
            
            // Check if we're on the feed page
            if (!window.location.pathname.includes('/feed')) {
                debugLog('WARNING: Not on feed page. Current path:', window.location.pathname);
            }
        }
        
        scrapedPosts = [];
        let skippedCount = 0;

        const elements = Array.isArray(postElements) ? postElements : Array.from(postElements);
        
        elements.forEach((element, index) => {
            const text = extractPostText(element);

            // Only include posts with meaningful content
            if (text && text.length > 20) {
                const engagement = extractEngagement(element);

                scrapedPosts.push({
                    id: generatePostId(element, index),
                    index: index,
                    author: extractAuthor(element),
                    authorHeadline: extractAuthorHeadline(element),
                    authorProfileUrl: extractAuthorProfileUrl(element),
                    text: text,
                    preview: text.substring(0, 150) + (text.length > 150 ? '...' : ''),
                    hashtags: extractHashtags(element),
                    engagement: engagement,
                    element: element
                });
            } else {
                skippedCount++;
                if (DEBUG && skippedCount <= 3) {
                    debugLog(`Skipped element ${index}: text length = ${text?.length || 0}`);
                }
            }
        });

        debugLog(`Scrape complete: ${scrapedPosts.length} posts with content, ${skippedCount} skipped`);
        
        // Return serializable data (without element reference)
        return scrapedPosts.map(p => ({
            id: p.id,
            index: p.index,
            author: p.author,
            authorHeadline: p.authorHeadline,
            authorProfileUrl: p.authorProfileUrl,
            text: p.text,
            preview: p.preview,
            hashtags: p.hashtags,
            engagement: p.engagement
        }));
    }

    /**
     * Scroll a post into view
     */
    function scrollToPost(postIndex) {
        const post = scrapedPosts.find(p => p.index === postIndex);
        if (post && post.element) {
            post.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Highlight the post briefly
            post.element.style.outline = '3px solid #0a66c2';
            setTimeout(() => {
                post.element.style.outline = '';
            }, 2000);
        }
    }

    /**
     * Find and click the comment button on a post
     */
    async function clickCommentButton(postElement) {
        // Try to find comment button within the post
        let commentBtn = postElement.querySelector(SELECTORS.commentButton);

        // If not found directly, look in social action bar
        if (!commentBtn) {
            const actionBar = postElement.querySelector('.feed-shared-social-action-bar, .social-details-social-activity');
            if (actionBar) {
                const buttons = actionBar.querySelectorAll('button');
                for (const btn of buttons) {
                    const label = btn.getAttribute('aria-label') || btn.innerText || '';
                    if (label.toLowerCase().includes('comment')) {
                        commentBtn = btn;
                        break;
                    }
                }
            }
        }

        if (commentBtn) {
            console.log('Found comment button, clicking...');
            commentBtn.click();
            // Wait longer for comment box to appear and render
            await new Promise(resolve => setTimeout(resolve, 800));
            return true;
        }

        console.log('Comment button not found');
        return false;
    }

    /**
     * Type text into the comment input
     */
    async function typeComment(postElement, comment) {
        // Wait for comment input to appear
        let commentInput = await waitForElement(SELECTORS.commentInput, 2000, postElement);

        // If not found in post, look globally (for modal comment boxes)
        if (!commentInput) {
            commentInput = await waitForElement(SELECTORS.commentInput, 1000, document);
        }

        if (commentInput) {
            console.log('Found comment input, typing...');

            // Focus the input
            commentInput.focus();
            await new Promise(resolve => setTimeout(resolve, 100));

            // Clear existing content
            commentInput.innerHTML = '';

            // Insert the comment text using execCommand for better compatibility
            document.execCommand('insertText', false, comment);

            // Also set innerHTML as fallback
            if (!commentInput.innerText.trim()) {
                commentInput.innerHTML = `<p>${comment}</p>`;
            }

            // Dispatch multiple events to trigger LinkedIn's handlers
            commentInput.dispatchEvent(new Event('input', { bubbles: true }));
            commentInput.dispatchEvent(new Event('change', { bubbles: true }));
            commentInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));

            await new Promise(resolve => setTimeout(resolve, 500));
            return true;
        }

        console.log('Comment input not found');
        return false;
    }

    /**
     * Submit the comment by clicking the send button
     */
    async function submitComment(postElement) {
        // Wait a bit for submit button to become enabled
        await new Promise(resolve => setTimeout(resolve, 300));

        // Try to find submit button within the post first
        let submitBtn = postElement.querySelector(SELECTORS.submitButton);

        // If not found, look globally
        if (!submitBtn) {
            submitBtn = document.querySelector(SELECTORS.submitButton);
        }

        // Look for any enabled submit-like button near comment box
        if (!submitBtn || submitBtn.disabled) {
            const allButtons = document.querySelectorAll('button[type="submit"], button.artdeco-button--primary');
            for (const btn of allButtons) {
                if (!btn.disabled && btn.offsetParent !== null) {
                    const rect = btn.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        submitBtn = btn;
                        break;
                    }
                }
            }
        }

        if (submitBtn && !submitBtn.disabled) {
            console.log('Found submit button, clicking...');
            submitBtn.click();
            await new Promise(resolve => setTimeout(resolve, 1000));
            return { success: true, message: 'Comment submitted!' };
        }

        // If button is disabled, comment might still need more input events
        console.log('Submit button not ready, trying again...');
        await new Promise(resolve => setTimeout(resolve, 500));

        submitBtn = document.querySelector(SELECTORS.submitButton);
        if (submitBtn && !submitBtn.disabled) {
            submitBtn.click();
            await new Promise(resolve => setTimeout(resolve, 1000));
            return { success: true, message: 'Comment submitted!' };
        }

        return { success: false, message: 'Submit button not found or disabled. Please submit manually.' };
    }

    /**
     * Inject a comment into a specific post (matches by ID/URN for reliability)
     */
    async function injectComment(postId, comment, autoSubmit = true) {
        // First try to find post in cached array
        let post = scrapedPosts.find(p => p.id === postId);

        // If not found or element is stale, try to re-locate by URN in DOM
        if (!post || !post.element || !document.body.contains(post.element)) {
            console.log('Post element stale or not found, re-locating by URN...');

            // Try to find element by data-urn attribute
            const postElement = document.querySelector(`[data-urn="${postId}"]`);
            if (postElement) {
                post = {
                    id: postId,
                    element: postElement
                };
                console.log('Re-located post element by URN');
            } else {
                // Fallback: try to find by index if postId looks like a generated ID
                const indexMatch = postId.match(/post-(\d+)-/);
                if (indexMatch) {
                    const allPosts = document.querySelectorAll(SELECTORS.feedPost);
                    const idx = parseInt(indexMatch[1], 10);
                    if (allPosts[idx]) {
                        post = {
                            id: postId,
                            element: allPosts[idx]
                        };
                        console.log('Re-located post element by index fallback');
                    }
                }
            }
        }

        if (!post || !post.element) {
            return { success: false, message: 'Post not found. Try rescanning the feed.' };
        }

        try {
            console.log(`Injecting comment for post ${postId}`);

            // Scroll post into view
            post.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            post.element.style.outline = '3px solid #0a66c2';
            setTimeout(() => { post.element.style.outline = ''; }, 2000);
            await new Promise(resolve => setTimeout(resolve, 600));

            // Click comment button to open comment box
            const clicked = await clickCommentButton(post.element);
            if (!clicked) {
                return { success: false, message: 'Could not find comment button' };
            }

            // Type the comment
            const typed = await typeComment(post.element, comment);
            if (!typed) {
                return { success: false, message: 'Could not find comment input' };
            }

            // Auto-submit the comment
            if (autoSubmit) {
                const result = await submitComment(post.element);
                return result;
            }

            return { success: true, message: 'Comment typed - ready to submit' };

        } catch (error) {
            console.error('Error injecting comment:', error);
            return { success: false, message: error.message };
        }
    }

    // Listen for messages from the popup
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        debugLog('Content script received message:', request.action);

        switch (request.action) {
            case 'scrapePosts':
                try {
                    const posts = scrapePosts();
                    debugLog(`Scraped ${posts.length} posts`);
                    
                    // Provide helpful debug info if no posts found
                    if (posts.length === 0) {
                        sendResponse({ 
                            success: true, 
                            posts: posts,
                            debug: {
                                url: window.location.href,
                                isOnFeed: window.location.pathname.includes('/feed'),
                                pageTitle: document.title,
                                hasMainElement: !!document.querySelector('main'),
                                hasFeedContainer: !!document.querySelector('.scaffold-finite-scroll__content'),
                                suggestion: 'Try scrolling the page to load posts, then scan again.'
                            }
                        });
                    } else {
                        sendResponse({ success: true, posts: posts });
                    }
                } catch (error) {
                    debugLog('Error scraping posts:', error);
                    sendResponse({ 
                        success: false, 
                        posts: [],
                        error: error.message 
                    });
                }
                break;

            case 'injectComment':
                // Support both postId (new) and postIndex (legacy) for backwards compatibility
                const targetPostId = request.postId || (request.postIndex !== undefined ? scrapedPosts.find(p => p.index === request.postIndex)?.id : null);
                injectComment(targetPostId, request.comment, request.autoSubmit !== false)
                    .then(result => sendResponse(result));
                return true; // Keep channel open for async response

            case 'scrollToPost':
                scrollToPost(request.postIndex);
                sendResponse({ success: true });
                break;

            case 'ping':
                sendResponse({ success: true, message: 'Content script active' });
                break;

            default:
                sendResponse({ success: false, message: 'Unknown action' });
        }
    });

    // Log that content script is loaded with helpful info
    debugLog('Content script loaded on LinkedIn');
    debugLog('Page URL:', window.location.href);
    debugLog('Is feed page:', window.location.pathname.includes('/feed'));
    
    // Run initial diagnostic on load
    setTimeout(() => {
        const feedContainer = document.querySelector('.scaffold-finite-scroll__content');
        const postCount = document.querySelectorAll(SELECTORS.feedPost).length;
        debugLog('Initial diagnostic: Feed container exists:', !!feedContainer, '| Posts found:', postCount);
        
        if (postCount === 0 && window.location.pathname.includes('/feed')) {
            debugLog('TIP: If no posts are showing, try scrolling down to load content');
        }
    }, 1000);

})();
