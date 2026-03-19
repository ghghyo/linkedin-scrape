// --- DOM Elements --- (will be initialized in DOMContentLoaded)
let generateBtn;
let resultsContainer;
let loader;
let errorMessage;
let highlightedTextContainer;
let highlightedTextElement;
let mainContent;
let currentPromptInfo;
let setPromptBtn;
let promptScreen;

// Auth UI (Sprint 8)
let authActionBtn, authOverlay, authEmailInput, authOtpInput, sendOtpBtn, verifyOtpBtn;
let backToEmailBtn, closeAuthBtn, authStepEmail, authStepOtp, userEmailDisplay, authMessage, authLoader;

// System Prompt UI
let systemPrompt = '';
let currentPromptName = 'Default';
let selectedModel = 'gemini-3-flash-preview'; // Default model - Gemini 3 Flash
const AVAILABLE_MODELS = {
    'gemini-3-flash-preview': 'Gemini 3 Flash (Fast)',
    'gemini-3-pro-preview': 'Gemini 3 Pro (Advanced)'
};
const BASE_PROMPTS = {
    'TechNovaTime LinkedIn (Default)': 'prompts/default-linkedin-technovatime.txt',
    'General LinkedIn Comments': 'prompts/general-linkedin-comments.txt',
    'Tech Industry Leader': 'prompts/tech-industry-leader.txt'
};

function initializeDOMElements() {
    // Initialize DOM elements
    generateBtn = document.getElementById('generate-btn');
    resultsContainer = document.getElementById('results-container');
    loader = document.getElementById('loader');
    errorMessage = document.getElementById('error-message');
    highlightedTextContainer = document.getElementById('highlighted-text-container');
    highlightedTextElement = document.getElementById('highlighted-text');
    mainContent = document.getElementById('main-content') || document.body;

    // Add current prompt info display
    currentPromptInfo = document.createElement('div');
    currentPromptInfo.id = 'current-prompt-info';
    currentPromptInfo.innerHTML = `
        <div>Current System Prompt: <span id="current-prompt-name">${currentPromptName}</span></div>
        <div>AI Model: <span id="current-model-name">${AVAILABLE_MODELS[selectedModel]}</span></div>
    `;
    mainContent.insertBefore(currentPromptInfo, mainContent.firstChild);

    setPromptBtn = document.createElement('button');
    setPromptBtn.textContent = 'Set System Prompt';
    setPromptBtn.id = 'set-prompt-btn';
    mainContent.insertBefore(setPromptBtn, currentPromptInfo.nextSibling);

    promptScreen = document.createElement('div');
    promptScreen.id = 'prompt-screen';
    promptScreen.className = 'prompt-screen';
    promptScreen.innerHTML = `
        <div class="prompt-modal">
            <h2>System Prompt Manager</h2>
            <div class="form-group">
                <label for="model-select">AI Model:</label>
                <select id="model-select">
                    <option value="gemini-3-flash-preview">Gemini 3 Flash (Fast)</option>
                    <option value="gemini-3-pro-preview">Gemini 3 Pro (Advanced)</option>
                </select>
            </div>
            <div class="form-group">
                <label for="system-prompt-field">System Prompt:</label>
                <textarea id="system-prompt-field" placeholder="Enter your system prompt here..."></textarea>
            </div>
            <div id="saved-prompts-list"></div>
            <div class="button-group">
                <button id="save-prompt-btn">Save as New</button>
                <button id="select-prompt-btn">Use This Prompt</button>
                <button id="close-prompt-btn">Close</button>
            </div>
        </div>
    `;
    document.body.appendChild(promptScreen);

    // Set up event listeners
    setPromptBtn.onclick = showPromptScreen;
    document.getElementById('close-prompt-btn').onclick = hidePromptScreen;

    // Save new prompt
    document.getElementById('save-prompt-btn').onclick = async () => {
        const field = document.getElementById('system-prompt-field');
        const prompt = field.value.trim();
        if (!prompt) return;
        chrome.storage.local.get(['savedPrompts'], (result) => {
            let prompts = result.savedPrompts || [];
            if (!prompts.includes(prompt)) prompts.push(prompt);
            chrome.storage.local.set({ savedPrompts: prompts }, loadSavedPrompts);
        });
    };

    // Use this prompt
    document.getElementById('select-prompt-btn').onclick = async () => {
        const field = document.getElementById('system-prompt-field');
        const modelSelect = document.getElementById('model-select');
        const prompt = field.value.trim();
        const model = modelSelect.value;
        if (!prompt) return;
        systemPrompt = prompt;
        selectedModel = model;

        // Determine prompt name for display
        let promptName = 'Custom';
        for (const [name, filePath] of Object.entries(BASE_PROMPTS)) {
            const basePrompt = await loadBasePrompt(filePath);
            if (basePrompt && basePrompt.trim() === prompt.trim()) {
                promptName = name;
                break;
            }
        }
        currentPromptName = promptName;

        chrome.storage.local.set({
            systemPrompt: prompt,
            selectedModel: model,
            currentPromptName: promptName
        }, () => {
            updateCurrentPromptDisplay();
            hidePromptScreen();
        });
    };

    // Initialize Auth Elements (Sprint 8)
    authActionBtn = document.getElementById('auth-action-btn');
    authOverlay = document.getElementById('auth-overlay');
    authEmailInput = document.getElementById('auth-email');
    authOtpInput = document.getElementById('auth-otp');
    sendOtpBtn = document.getElementById('send-otp-btn');
    verifyOtpBtn = document.getElementById('verify-otp-btn');
    backToEmailBtn = document.getElementById('back-to-email-btn');
    closeAuthBtn = document.getElementById('close-auth-btn');
    authStepEmail = document.getElementById('auth-step-email');
    authStepOtp = document.getElementById('auth-step-otp');
    userEmailDisplay = document.getElementById('user-email-display');
    authMessage = document.getElementById('auth-message');
    authLoader = document.getElementById('auth-loader');

    // Auth Event Listeners
    if (authActionBtn) authActionBtn.addEventListener('click', handleAuthAction);
    if (sendOtpBtn) sendOtpBtn.addEventListener('click', handleSendOtp);
    if (verifyOtpBtn) verifyOtpBtn.addEventListener('click', handleVerifyOtp);
    if (backToEmailBtn) backToEmailBtn.addEventListener('click', () => showAuthStep('email'));

    if (closeAuthBtn) {
        closeAuthBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            authOverlay.classList.add('hidden');
        });
    }

    // Close on click outside
    if (authOverlay) {
        authOverlay.addEventListener('click', (e) => {
            if (e.target === authOverlay) {
                authOverlay.classList.add('hidden');
            }
        });
    }

    // Initial Auth Refresh
    refreshAuthStatus();

    // Main function to handle the generate button click.
    generateBtn.addEventListener('click', async () => {
        // 1. Reset UI
        resultsContainer.innerHTML = '';
        errorMessage.classList.add('hidden');
        loader.classList.remove('hidden');
        generateBtn.disabled = true;

        if (!API_KEY || API_KEY.trim() === '') {
            showError("API Key is missing. Please set up your API key first.");
            loader.classList.add('hidden');
            generateBtn.disabled = false;
            showApiKeySetup();
            return;
        }

        try {
            // 2. Get highlighted text
            const selectedText = await getSelectedText();
            if (!selectedText || selectedText.trim() === '') {
                throw new Error("No text highlighted. Please select some text on the page first.");
            }

            // 3. Fetch comments from API
            const responseData = await fetchCommentSuggestions(selectedText);

            // 4. Parse the response
            // The actual text content is nested. We need to extract and parse it.
            const responseText = responseData.candidates[0].content.parts[0].text;
            const jsonResponse = JSON.parse(responseText);

            if (!jsonResponse.comments || !Array.isArray(jsonResponse.comments)) {
                throw new Error("Invalid response format from API.");
            }

            // 5. Display results
            displayResults(jsonResponse.comments);

        } catch (error) {
            console.error("Error:", error);
            showError(error.message);
        } finally {
            // 6. Reset UI state
            loader.classList.add('hidden');
            generateBtn.disabled = false;
        }
    });
}

function showPromptScreen() {
    document.body.classList.add('modal-open');
    promptScreen.style.display = 'flex';
    const field = document.getElementById('system-prompt-field');
    const modelSelect = document.getElementById('model-select');
    field.value = systemPrompt;
    modelSelect.value = selectedModel;
    loadSavedPrompts();
}

function hidePromptScreen() {
    document.body.classList.remove('modal-open');
    promptScreen.style.display = 'none';
}

function updateCurrentPromptDisplay() {
    const nameElement = document.getElementById('current-prompt-name');
    const modelElement = document.getElementById('current-model-name');
    if (nameElement) nameElement.textContent = currentPromptName;
    if (modelElement) modelElement.textContent = AVAILABLE_MODELS[selectedModel];
}

// Load saved prompts
async function loadBasePrompt(filePath) {
    try {
        const response = await fetch(chrome.runtime.getURL(filePath));
        return await response.text();
    } catch (error) {
        console.error('Error loading base prompt:', error);
        return null;
    }
}

function loadSavedPrompts() {
    const listDiv = document.getElementById('saved-prompts-list');
    listDiv.innerHTML = '';

    // Add base prompts section
    const baseHeader = document.createElement('h3');
    baseHeader.textContent = 'Base Prompts';
    baseHeader.style.margin = '10px 0 5px 0';
    baseHeader.style.fontSize = '14px';
    baseHeader.style.fontWeight = 'bold';
    listDiv.appendChild(baseHeader);

    // Load base prompts
    Object.entries(BASE_PROMPTS).forEach(([name, filePath]) => {
        const btn = document.createElement('button');
        btn.textContent = name;
        btn.onclick = async () => {
            const promptText = await loadBasePrompt(filePath);
            if (promptText) {
                document.getElementById('system-prompt-field').value = promptText;
            }
        };
        listDiv.appendChild(btn);
    });

    // Add user prompts section
    chrome.storage.local.get(['savedPrompts'], (result) => {
        const prompts = result.savedPrompts || [];
        if (prompts.length > 0) {
            const userHeader = document.createElement('h3');
            userHeader.textContent = 'User Saved Prompts';
            userHeader.style.margin = '15px 0 5px 0';
            userHeader.style.fontSize = '14px';
            userHeader.style.fontWeight = 'bold';
            listDiv.appendChild(userHeader);

            prompts.forEach((p, idx) => {
                const btn = document.createElement('button');
                btn.textContent = `Custom ${idx + 1}`;
                btn.onclick = () => {
                    document.getElementById('system-prompt-field').value = p;
                };
                listDiv.appendChild(btn);
            });
        }
    });
}

// --- Gemini API Configuration ---
let API_KEY = ''; // Will be loaded from storage

function getApiUrl() {
    return `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${API_KEY}`;
}

/**
 * Injects a content script into the active tab to get selected text.
 * @returns {Promise<string>} A promise that resolves with the selected text.
 */
async function getSelectedText() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        // Cannot execute script on chrome:// URLs
        if (!tab || !tab.url || tab.url.startsWith('chrome://')) {
            return '';
        }

        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => window.getSelection().toString(),
        });
        // The result is an array, we want the first element's result property.
        return (results && results[0]) ? results[0].result : '';
    } catch (err) {
        console.warn('Error fetching selected text:', err);
        return '';
    }
}

/**
 * Fetches comment suggestions from the Gemini API.
 * @param {string} text - The text to generate comments for.
 * @returns {Promise<Object>} A promise that resolves with the parsed JSON response.
 */
async function fetchCommentSuggestions(text) {

    // Use the current system prompt if set, otherwise fallback to default
    let prompt = systemPrompt && systemPrompt.trim().length > 0 ? systemPrompt : await loadBasePrompt(BASE_PROMPTS['TechNovaTime LinkedIn (Default)']);

    if (!prompt) {
        prompt = 'Generate 3 thoughtful comments for the following post:';
    }

    prompt += `\n\nPost Text: "${text}"`;

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

    const response = await fetch(getApiUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        let errorText = '';
        try {
            const errorBody = await response.json();
            errorText = errorBody.error?.message || JSON.stringify(errorBody);
            console.error("API Error:", errorBody);
        } catch (e) {
            errorText = await response.text();
            console.error("API Error (non-JSON):", errorText);
        }
        throw new Error(`API request failed with status ${response.status}. ${errorText}`);
    }

    const data = await response.json();
    return data;
}

/**
 * Renders the generated comments in the popup.
 * @param {string[]} comments - An array of comment strings.
 */
function displayResults(comments) {
    resultsContainer.innerHTML = ''; // Clear previous results
    comments.forEach(commentText => {
        const commentDiv = document.createElement('div');
        commentDiv.className = 'comment';

        const textP = document.createElement('p');
        textP.textContent = commentText;

        const copyBtn = document.createElement('button');
        copyBtn.textContent = 'Copy';
        copyBtn.className = 'copy-button';
        copyBtn.onclick = () => {
            // Use the clipboard API for a more modern approach
            navigator.clipboard.writeText(commentText).then(() => {
                copyBtn.textContent = 'Copied!';
                setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
            }).catch(err => {
                console.error('Failed to copy text: ', err);
                // Fallback for older systems if needed, though less reliable in extensions
                const textArea = document.createElement("textarea");
                textArea.value = commentText;
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                try {
                    document.execCommand('copy');
                    copyBtn.textContent = 'Copied!';
                    setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
                } catch (err) {
                    console.error('Fallback copy failed', err);
                }
                document.body.removeChild(textArea);
            });
        };

        commentDiv.appendChild(textP);
        commentDiv.appendChild(copyBtn);
        resultsContainer.appendChild(commentDiv);
    });
}

/**
 * Displays an error message in the popup.
 * @param {string} message - The error message to display.
 */
function showError(message) {
    errorMessage.textContent = message;
    errorMessage.classList.remove('hidden');
}

// API Key Management
function showApiKeySetup() {
    document.body.classList.add('modal-open');
    const apiKeyScreen = document.createElement('div');
    apiKeyScreen.id = 'api-key-screen';
    apiKeyScreen.className = 'prompt-screen';
    apiKeyScreen.style.display = 'flex';
    apiKeyScreen.innerHTML = `
        <div class="prompt-modal">
            <h2>🔑 API Key Setup</h2>
            <p style="margin-bottom: 20px; color: #666; line-height: 1.5;">
                To use this extension, you need a free Google Gemini API key.
            </p>
            <div class="form-group">
                <label for="api-key-input">
                    <strong>Step 1:</strong> Get your API key from 
                    <a href="https://aistudio.google.com/app/apikey" target="_blank" style="color: #0078d4;">Google AI Studio</a>
                </label>
            </div>
            <div class="form-group">
                <label for="api-key-input"><strong>Step 2:</strong> Enter your API key below:</label>
                <input type="password" id="api-key-input" placeholder="AIza..." style="width: 100%; padding: 12px; border: 2px solid #ddd; border-radius: 6px; font-family: monospace;">
            </div>
            <div style="background: #f0f8ff; border: 1px solid #b8deff; border-radius: 6px; padding: 12px; margin: 15px 0; font-size: 13px;">
                <strong>🔒 Security:</strong> Your API key is stored securely in your browser and never shared.
            </div>
            <div class="button-group">
                <button id="save-api-key-btn">Save & Continue</button>
                <button id="test-api-key-btn" style="background: #f5f5f5; color: #666; border-color: #ccc;">Test Key</button>
            </div>
            <div id="api-key-status" style="margin-top: 15px; font-size: 13px;"></div>
        </div>
    `;
    document.body.appendChild(apiKeyScreen);

    // Save API key
    document.getElementById('save-api-key-btn').onclick = async () => {
        const keyInput = document.getElementById('api-key-input');
        const key = keyInput.value.trim();
        if (!key) {
            showApiKeyStatus('Please enter an API key', 'error');
            return;
        }
        if (!key.startsWith('AIza')) {
            showApiKeyStatus('API key should start with "AIza"', 'error');
            return;
        }

        API_KEY = key;
        chrome.storage.local.set({ apiKey: key }, async () => {
            showApiKeyStatus('API key saved successfully! 🎉', 'success');

            // Load default system prompt and settings
            const defaultPrompt = await loadBasePrompt(BASE_PROMPTS['TechNovaTime LinkedIn (Default)']);
            if (defaultPrompt) {
                systemPrompt = defaultPrompt;
                chrome.storage.local.set({
                    systemPrompt: defaultPrompt,
                    selectedModel: 'gemini-3-flash-preview',
                    currentPromptName: 'TechNovaTime LinkedIn (Default)'
                }, () => {
                    setTimeout(() => {
                        document.body.removeChild(apiKeyScreen);
                        document.body.classList.remove('modal-open');

                        updateCurrentPromptDisplay();
                        updateApiKeyDisplay();
                        initializeExtension();
                    }, 1500);
                });
            } else {
                setTimeout(() => {
                    document.body.removeChild(apiKeyScreen);
                    document.body.classList.remove('modal-open');

                    initializeExtension();
                }, 1500);
            }
        });
    };

    // Test API key
    document.getElementById('test-api-key-btn').onclick = async () => {
        const keyInput = document.getElementById('api-key-input');
        const key = keyInput.value.trim();
        if (!key) {
            showApiKeyStatus('Please enter an API key to test', 'error');
            return;
        }

        showApiKeyStatus('Testing API key...', 'loading');

        try {
            const testResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${key}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: 'Hello' }] }]
                })
            });

            if (testResponse.ok) {
                showApiKeyStatus('✅ API key is valid!', 'success');
            } else {
                const errorData = await testResponse.json();
                showApiKeyStatus(`❌ Invalid API key: ${errorData.error?.message || 'Unknown error'}`, 'error');
            }
        } catch (error) {
            showApiKeyStatus(`❌ Connection error: ${error.message}`, 'error');
        }
    };
}

function showApiKeyStatus(message, type) {
    const statusDiv = document.getElementById('api-key-status');
    statusDiv.textContent = message;
    statusDiv.style.color = type === 'error' ? '#d32f2f' : type === 'success' ? '#2e7d32' : '#666';
    statusDiv.style.fontWeight = type === 'loading' ? 'normal' : 'bold';
}

function initializeExtension() {
    // Load and check for selected text
    getSelectedText().then(selectedText => {
        if (selectedText && selectedText.trim() !== '') {
            highlightedTextElement.textContent = `"${selectedText.substring(0, 150)}..."`;
            highlightedTextContainer.classList.remove('hidden');
            generateBtn.disabled = false;
            generateBtn.textContent = 'Generate Comments';
        } else {
            generateBtn.disabled = true;
            generateBtn.textContent = 'Highlight text first!';
        }
    });

    // Show current API key status (masked)
    if (API_KEY) {
        updateApiKeyDisplay();
    }
}

function updateApiKeyDisplay() {
    // Add API key status to current prompt info
    let apiKeyInfo = document.getElementById('api-key-info');
    if (!apiKeyInfo) {
        apiKeyInfo = document.createElement('div');
        apiKeyInfo.id = 'api-key-info';
        apiKeyInfo.style.fontSize = '11px';
        apiKeyInfo.style.color = '#888';
        apiKeyInfo.style.marginTop = '4px';
        document.getElementById('current-prompt-info').appendChild(apiKeyInfo);
    }

    const maskedKey = API_KEY ? `${API_KEY.substring(0, 8)}...${API_KEY.substring(API_KEY.length - 4)}` : 'Not set';
    apiKeyInfo.innerHTML = `API Key: ${maskedKey} <button onclick="showApiKeyManagement()" style="background:none;border:none;color:#0078d4;text-decoration:underline;cursor:pointer;font-size:11px;padding:0;margin-left:5px;">Change</button>`;
}

function showApiKeyManagement() {
    document.body.classList.add('modal-open');
    const apiKeyScreen = document.createElement('div');
    apiKeyScreen.id = 'api-key-management-screen';
    apiKeyScreen.className = 'prompt-screen';
    apiKeyScreen.innerHTML = `
        <div class="prompt-modal">
            <h2>🔑 Manage API Key</h2>
            <div class="form-group">
                <label for="current-api-key">Current API Key:</label>
                <input type="password" id="current-api-key" value="${API_KEY}" style="width: 100%; padding: 12px; border: 2px solid #ddd; border-radius: 6px; font-family: monospace;">
            </div>
            <div class="button-group">
                <button id="update-api-key-btn">Update Key</button>
                <button id="test-current-api-key-btn" style="background: #f5f5f5; color: #666; border-color: #ccc;">Test Key</button>
                <button id="close-api-key-mgmt-btn" style="background: #f5f5f5; color: #666; border-color: #ccc;">Close</button>
            </div>
            <div id="api-key-mgmt-status" style="margin-top: 15px; font-size: 13px;"></div>
        </div>
    `;
    document.body.appendChild(apiKeyScreen);

    // Update API key
    document.getElementById('update-api-key-btn').onclick = () => {
        const keyInput = document.getElementById('current-api-key');
        const key = keyInput.value.trim();
        if (!key) {
            showApiKeyMgmtStatus('Please enter an API key', 'error');
            return;
        }
        if (!key.startsWith('AIza')) {
            showApiKeyMgmtStatus('API key should start with "AIza"', 'error');
            return;
        }

        API_KEY = key;
        chrome.storage.local.set({ apiKey: key }, () => {
            showApiKeyMgmtStatus('API key updated successfully! 🎉', 'success');
            updateApiKeyDisplay();
            setTimeout(() => {
                document.body.removeChild(apiKeyScreen);
                document.body.classList.remove('modal-open');
            }, 1500);
        });
    };

    // Test current API key
    document.getElementById('test-current-api-key-btn').onclick = async () => {
        const keyInput = document.getElementById('current-api-key');
        const key = keyInput.value.trim();

        showApiKeyMgmtStatus('Testing API key...', 'loading');

        try {
            const testResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${key}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: 'Hello' }] }]
                })
            });

            if (testResponse.ok) {
                showApiKeyMgmtStatus('✅ API key is valid!', 'success');
            } else {
                const errorData = await testResponse.json();
                showApiKeyMgmtStatus(`❌ Invalid API key: ${errorData.error?.message || 'Unknown error'}`, 'error');
            }
        } catch (error) {
            showApiKeyMgmtStatus(`❌ Connection error: ${error.message}`, 'error');
        }
    };

    // Close management screen
    document.getElementById('close-api-key-mgmt-btn').onclick = () => {
        document.body.removeChild(apiKeyScreen);
        document.body.classList.remove('modal-open');
    };
}

function showApiKeyMgmtStatus(message, type) {
    const statusDiv = document.getElementById('api-key-mgmt-status');
    statusDiv.textContent = message;
    statusDiv.style.color = type === 'error' ? '#d32f2f' : type === 'success' ? '#2e7d32' : '#666';
    statusDiv.style.fontWeight = type === 'loading' ? 'normal' : 'bold';
}

// Removed duplicate event listener - this is now handled in initializeDOMElements()

/**
 * On popup load, immediately check for API key and show setup if needed.
 */
document.addEventListener('DOMContentLoaded', async () => {
    // Always initialize DOM elements first to ensure popup structure exists
    initializeDOMElements();

    // Initialize bulk mode
    initializeBulkMode();

    // Check for API key
    chrome.storage.local.get(['apiKey'], async (result) => {
        if (!result.apiKey) {
            // Show API key setup for new users
            generateBtn.disabled = true;
            generateBtn.textContent = "API Key Required";
            showApiKeySetup();
            return;
        }

        // API key exists, proceed with full initialization
        API_KEY = result.apiKey;

        // Initially disable the generate button until setup is complete
        generateBtn.disabled = true;
        generateBtn.textContent = "Setting up...";

        // Check for selected text
        const selectedText = await getSelectedText();
        if (selectedText && selectedText.trim() !== '') {
            highlightedTextElement.textContent = `"${selectedText.substring(0, 150)}..."`;
            highlightedTextContainer.classList.remove('hidden');
        }

        // Load remaining settings
        chrome.storage.local.get(['systemPrompt', 'selectedModel', 'currentPromptName'], async (settingsResult) => {
            if (settingsResult.systemPrompt) {
                systemPrompt = settingsResult.systemPrompt;
            } else {
                // Load default prompt if none is set
                const defaultPrompt = await loadBasePrompt(BASE_PROMPTS['TechNovaTime LinkedIn (Default)']);
                if (defaultPrompt) {
                    systemPrompt = defaultPrompt;
                    chrome.storage.local.set({
                        systemPrompt: defaultPrompt
                    });
                }
            }

            if (settingsResult.selectedModel) {
                selectedModel = settingsResult.selectedModel;
            } else {
                chrome.storage.local.set({ selectedModel: 'gemini-3-flash-preview' });
            }

            if (settingsResult.currentPromptName) {
                currentPromptName = settingsResult.currentPromptName;
            } else {
                currentPromptName = 'TechNovaTime LinkedIn (Default)';
                chrome.storage.local.set({ currentPromptName: currentPromptName });
            }

            updateCurrentPromptDisplay();
            updateApiKeyDisplay();

            // Initialize Supabase if configured
            if (typeof window.SupabaseClient !== 'undefined') {
                window.SupabaseClient.init().then(configured => {
                    console.log('Supabase configured:', configured);
                });
            }

            initializeExtension();
            loadGoalsDashboard(); // Sprint 7: Load goals on startup
        });
    });
});

// ==================== BULK MODE ====================

// Bulk mode state
let bulkState = {
    isActive: false,
    posts: [],
    comments: [], // Array of {postIndex, comments: []}
    currentIndex: 0,
    selectedComment: '',
    sentCount: 0,
    skippedCount: 0
};

/**
 * Initialize bulk mode UI and event listeners
 */
function initializeBulkMode() {
    const singleModeBtn = document.getElementById('single-mode-btn');
    const bulkModeBtn = document.getElementById('bulk-mode-btn');
    const historyModeBtn = document.getElementById('history-mode-btn');
    const singleModeContent = document.getElementById('single-mode-content');
    const bulkModeContent = document.getElementById('bulk-mode-content');
    const historyModeContent = document.getElementById('history-mode-content');
    const scanFeedBtn = document.getElementById('scan-feed-btn');
    const skipBtn = document.getElementById('skip-btn');
    const sendBtn = document.getElementById('send-btn');
    const carouselClose = document.getElementById('carousel-close');
    const commentEdit = document.getElementById('comment-edit');
    const exportHistoryBtn = document.getElementById('export-history-btn');

    /**
     * Unified mode switcher to prevent "stuck" tabs
     */
    function switchMode(targetMode) {
        const modes = ['single', 'bulk', 'history', 'analytics', 'outreach', 'goals'];

        // Update Buttons
        modes.forEach(mode => {
            const btn = document.getElementById(`${mode}-mode-btn`);
            const content = document.getElementById(`${mode}-mode-content`);

            if (mode === targetMode) {
                btn?.classList.add('active');
                content?.classList.remove('hidden');
            } else {
                btn?.classList.remove('active');
                content?.classList.add('hidden');
            }
        });

        // Specific Tab Actions
        if (targetMode === 'bulk') checkLinkedInPage();
        if (targetMode === 'history') loadCommentHistory();
        if (targetMode === 'analytics') loadAnalyticsDashboard();
        if (targetMode === 'outreach') initOutreachTab();
        if (targetMode === 'goals') loadGoalsDashboard();
    }

    // Mode toggle listeners
    singleModeBtn?.addEventListener('click', () => switchMode('single'));
    bulkModeBtn?.addEventListener('click', () => switchMode('bulk'));
    historyModeBtn?.addEventListener('click', () => switchMode('history'));

    document.getElementById('analytics-mode-btn')?.addEventListener('click', () => switchMode('analytics'));
    document.getElementById('outreach-mode-btn')?.addEventListener('click', () => switchMode('outreach'));
    document.getElementById('goals-mode-btn')?.addEventListener('click', () => switchMode('goals'));

    // Refresh analytics button
    document.getElementById('refresh-analytics-btn')?.addEventListener('click', () => {
        loadAnalyticsDashboard();
    });

    // Scan feed button
    scanFeedBtn?.addEventListener('click', async () => {
        await scanLinkedInFeed();
    });

    // Skip button
    skipBtn?.addEventListener('click', () => {
        bulkState.skippedCount++;
        moveToNextPost();
    });

    // Send button
    sendBtn?.addEventListener('click', async () => {
        await sendComment();
    });

    // Close carousel
    carouselClose?.addEventListener('click', () => {
        resetBulkMode();
    });

    // Comment edit updates selected comment
    commentEdit?.addEventListener('input', (e) => {
        bulkState.selectedComment = e.target.value;
    });

    // Export history button
    exportHistoryBtn?.addEventListener('click', () => {
        exportHistoryToCSV();
    });

    // Auto-find button (Sprint 6)
    document.getElementById('auto-find-btn')?.addEventListener('click', async () => {
        await autoFindAndComment();
    });
}

/**
 * Load and display comment history
 */
function loadCommentHistory() {
    const historyList = document.getElementById('history-list');
    const historyCount = document.getElementById('history-count');

    chrome.storage.local.get(['commentHistory'], (result) => {
        const history = result.commentHistory || [];

        historyCount.textContent = `${history.length} comments saved`;

        if (history.length === 0) {
            historyList.innerHTML = '<div class="history-empty">No comments yet. Start commenting in Bulk Mode!</div>';
            return;
        }

        historyList.innerHTML = history.map(entry => {
            const date = new Date(entry.timestamp);
            const timeStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            return `
                <div class="history-item">
                    <div class="history-meta">
                        <span class="history-author">📝 ${escapeHtml(entry.postAuthor || 'Unknown')}</span>
                        <span>${timeStr}</span>
                    </div>
                    <div class="history-post">${escapeHtml(entry.postPreview || entry.postContent?.substring(0, 100) || '')}</div>
                    <div class="history-comment">${escapeHtml(entry.commentSent)}</div>
                </div>
            `;
        }).join('');
    });
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

/**
 * Export comment history to CSV
 */
function exportHistoryToCSV() {
    chrome.storage.local.get(['commentHistory'], (result) => {
        const history = result.commentHistory || [];

        if (history.length === 0) {
            alert('No history to export!');
            return;
        }

        // CSV headers
        const headers = ['Timestamp', 'Author', 'Post Content', 'Comment Sent'];

        // Build CSV rows
        const rows = history.map(entry => [
            entry.timestamp,
            `"${(entry.postAuthor || '').replace(/"/g, '""')}"`,
            `"${(entry.postContent || '').replace(/"/g, '""')}"`,
            `"${(entry.commentSent || '').replace(/"/g, '""')}"`
        ].join(','));

        const csv = [headers.join(','), ...rows].join('\n');

        // Create download
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `comment-history-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    });
}

/**
 * Update daily quota display
 */
async function updateDailyQuotaDisplay() {
    const quotaEl = document.getElementById('daily-quota');
    const quotaCount = document.getElementById('quota-count');
    const quotaLimit = document.getElementById('quota-limit');

    if (!quotaEl || !quotaCount || !quotaLimit) return;

    // Use SmartPrompts if available
    if (typeof window.SmartPrompts !== 'undefined') {
        const status = await window.SmartPrompts.checkDailyLimit(20);
        quotaCount.textContent = status.count;
        quotaLimit.textContent = status.limit;

        // Update styling based on remaining
        quotaEl.classList.remove('hidden', 'warning', 'limit-reached');
        if (status.remaining <= 0) {
            quotaEl.classList.add('limit-reached');
        } else if (status.remaining <= 5) {
            quotaEl.classList.add('warning');
        }
    } else {
        // Fallback - read from storage
        chrome.storage.local.get(['dailyCommentCount'], (result) => {
            const count = result.dailyCommentCount || 0;
            quotaCount.textContent = count;
            quotaEl.classList.remove('hidden');
        });
    }
}

/**
 * Load analytics dashboard data
 */
async function loadAnalyticsDashboard() {
    // Check if Analytics library is available
    if (typeof window.Analytics === 'undefined') {
        console.log('Analytics library not loaded');
        return;
    }

    try {
        const summary = await window.Analytics.getDashboardSummary();

        // Update main metrics
        document.getElementById('total-comments').textContent = summary.allTime.totalComments;
        document.getElementById('total-reactions').textContent = summary.allTime.totalReactions;
        document.getElementById('avg-engagement').textContent = summary.allTime.engagementRate;

        // Update style breakdown
        const styleBreakdown = document.getElementById('style-breakdown');
        if (Object.keys(summary.byStyle).length > 0) {
            styleBreakdown.innerHTML = Object.entries(summary.byStyle)
                .filter(([_, m]) => m.totalComments > 0)
                .sort((a, b) => b[1].engagementRate - a[1].engagementRate)
                .map(([style, metrics]) => `
                    <div class="style-row">
                        <span class="style-name">${style}</span>
                        <div class="style-stats">
                            <span>${metrics.totalComments} sent</span>
                            <span class="style-engagement">${metrics.engagementRate} avg</span>
                        </div>
                    </div>
                `).join('');
        } else {
            styleBreakdown.innerHTML = '<p class="text-sm text-gray-500">No style data yet</p>';
        }

        // Update A/B test results
        const abResults = document.getElementById('ab-test-results');
        if (typeof window.ABTesting !== 'undefined') {
            const tests = await window.ABTesting.getAllTestResults();
            if (tests.length > 0) {
                abResults.innerHTML = tests.map(test => `
                    <div class="test-result">
                        <div class="test-name">${test.testId}</div>
                        <div class="test-winner">
                            ${test.winner
                        ? `Winner: ${test.winner} (${Math.round(test.confidence * 100)}% confidence)`
                        : `${test.totalSamples} samples - Keep testing`}
                        </div>
                    </div>
                `).join('');
            } else {
                abResults.innerHTML = '<p class="text-sm text-gray-500">No A/B tests running</p>';
            }
        }

        // Update recommendations
        const recsEl = document.getElementById('recommendations');
        if (summary.recommendations?.suggestedActions?.length > 0) {
            recsEl.innerHTML = summary.recommendations.suggestedActions.map(rec => `
                <div class="recommendation-item">💡 ${rec}</div>
            `).join('');
        } else {
            recsEl.innerHTML = '<p class="text-sm text-gray-500">Send more comments for insights</p>';
        }

    } catch (error) {
        console.error('Error loading analytics:', error);
    }
}

/**
 * Check if current tab is LinkedIn
 */
async function checkLinkedInPage() {
    const linkedinCheck = document.getElementById('linkedin-check');
    const scanFeedBtn = document.getElementById('scan-feed-btn');
    const bulkStatus = document.getElementById('bulk-status');

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        // Check if we can access the tab URL (chrome:// and other restricted URLs will be undefined or inaccessible)
        if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
            linkedinCheck.textContent = '⚠️ Navigate to LinkedIn feed first';
            bulkStatus.classList.add('error');
            bulkStatus.classList.remove('success');
            scanFeedBtn.disabled = true;
            return;
        }

        if (tab.url.includes('linkedin.com')) {
            linkedinCheck.textContent = '✅ LinkedIn detected! Ready to scan.';
            bulkStatus.classList.remove('error');
            bulkStatus.classList.add('success');
            scanFeedBtn.disabled = false;
            document.getElementById('auto-find-btn').disabled = false;

            // Update daily quota display
            updateDailyQuotaDisplay();
        } else {
            linkedinCheck.textContent = '⚠️ Navigate to LinkedIn feed first';
            bulkStatus.classList.add('error');
            bulkStatus.classList.remove('success');
            scanFeedBtn.disabled = true;
            document.getElementById('auto-find-btn').disabled = true;
        }
    } catch (error) {
        console.log('Tab check error (expected on restricted pages):', error.message);
        linkedinCheck.textContent = '⚠️ Navigate to LinkedIn feed first';
        bulkStatus.classList.add('error');
        scanFeedBtn.disabled = true;
        document.getElementById('auto-find-btn').disabled = true;
    }
}

/**
 * Scan LinkedIn feed for posts
 */
async function scanLinkedInFeed() {
    const bulkLoader = document.getElementById('bulk-loader');
    const scanFeedBtn = document.getElementById('scan-feed-btn');
    const linkedinCheck = document.getElementById('linkedin-check');

    scanFeedBtn.disabled = true;
    bulkLoader.classList.remove('hidden');
    linkedinCheck.textContent = '🔍 Scanning feed...';

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        // Try to inject content script if not already present
        let response;
        try {
            response = await chrome.tabs.sendMessage(tab.id, { action: 'scrapePosts' });
        } catch (connectionError) {
            // Content script not loaded - try to inject it
            console.log('Content script not found, injecting...');
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['content.js']
                });
                // Wait a moment for script to initialize
                await new Promise(resolve => setTimeout(resolve, 200));
                response = await chrome.tabs.sendMessage(tab.id, { action: 'scrapePosts' });
            } catch (injectError) {
                throw new Error('Could not connect to LinkedIn page. Please refresh the page and try again.');
            }
        }

        if (response.success && response.posts.length > 0) {
            // Enrich posts with discovery data (watchlist, engagement scores, topics)
            if (typeof window.DiscoveryEngine !== 'undefined') {
                const enriched = window.DiscoveryEngine.enrichPostsWithDiscoveryData(response.posts);
                const prioritized = window.DiscoveryEngine.prioritizeWatchlistPosts(enriched);
                bulkState.posts = prioritized.all; // Watchlist first, then by engagement

                const watchlistCount = prioritized.stats.watchlist;
                linkedinCheck.textContent = watchlistCount > 0
                    ? `✅ Found ${response.posts.length} posts (${watchlistCount} from watchlist)!`
                    : `✅ Found ${response.posts.length} posts!`;
            } else {
                bulkState.posts = response.posts;
                linkedinCheck.textContent = `✅ Found ${response.posts.length} posts!`;
            }

            // Generate comments for all posts
            await generateBulkComments();

        } else {
            // Show more helpful error message with debug info
            let errorMsg = '⚠️ No posts found.';
            
            if (response.debug) {
                console.log('Scrape debug info:', response.debug);
                
                if (!response.debug.isOnFeed) {
                    errorMsg = '⚠️ Navigate to your LinkedIn feed (linkedin.com/feed) first.';
                } else if (!response.debug.hasFeedContainer) {
                    errorMsg = '⚠️ Feed not loaded. Scroll down to load posts, then try again.';
                } else {
                    errorMsg = '⚠️ No posts found. Try scrolling down to load more posts.';
                }
            }
            
            linkedinCheck.textContent = errorMsg;
        }
    } catch (error) {
        console.error('Scan error:', error);
        linkedinCheck.textContent = '❌ Error scanning. Refresh the page and try again.';
    } finally {
        bulkLoader.classList.add('hidden');
        scanFeedBtn.disabled = false;
    }
}

/**
 * Generate comments for all scraped posts
 */
async function generateBulkComments() {
    const linkedinCheck = document.getElementById('linkedin-check');
    const bulkLoader = document.getElementById('bulk-loader');

    linkedinCheck.textContent = `🤖 Generating comments for ${bulkState.posts.length} posts...`;
    bulkLoader.classList.remove('hidden');

    // Listen for progress updates from background
    const progressListener = (message) => {
        if (message.action === 'batchProgress') {
            linkedinCheck.textContent = `🤖 Generating ${message.completed}/${message.total}...`;
        }
    };
    chrome.runtime.onMessage.addListener(progressListener);

    try {
        // Add audience profiles to each post for smart generation
        const enrichedPosts = bulkState.posts.map(post => {
            let audienceProfile = null;
            if (typeof window.AudienceInference !== 'undefined') {
                audienceProfile = window.AudienceInference.inferAudience(
                    { authorHeadline: post.authorHeadline },
                    post
                );
            }
            return { ...post, audienceProfile };
        });

        // Use background script for batch generation
        const response = await chrome.runtime.sendMessage({
            action: 'generateBatchComments',
            posts: enrichedPosts
        });

        if (response.success) {
            bulkState.comments = response.results;
            linkedinCheck.textContent = `✅ Comments ready for ${response.results.length} posts!`;

            // Show carousel
            showCarousel();
        } else {
            linkedinCheck.textContent = `❌ Error: ${response.error || 'Failed to generate comments'}`;
        }
    } catch (error) {
        console.error('Generation error:', error);
        linkedinCheck.textContent = '❌ Error generating comments';
    } finally {
        chrome.runtime.onMessage.removeListener(progressListener);
        bulkLoader.classList.add('hidden');
    }
}

/**
 * Show the carousel with first post
 */
function showCarousel() {
    const carouselContainer = document.getElementById('carousel-container');
    carouselContainer.classList.remove('hidden');

    bulkState.currentIndex = 0;
    displayCurrentPost();
}

/**
 * Display current post in carousel
 */
function displayCurrentPost() {
    const post = bulkState.posts[bulkState.currentIndex];
    const commentsData = bulkState.comments.find(c => c.postIndex === post.index);

    // Update progress
    document.getElementById('carousel-progress').textContent =
        `Post ${bulkState.currentIndex + 1} of ${bulkState.posts.length}`;

    // Build author info with watchlist badge
    let authorInfo = post.authorHeadline
        ? `📝 ${post.author} • ${post.authorHeadline}`
        : `📝 ${post.author}`;

    // Add watchlist badge if from watchlist
    if (post.isWatchlist && post.watchlistInfo) {
        authorInfo = `⭐ ${authorInfo} <span class="watchlist-badge">#${post.watchlistInfo.rank} Watchlist</span>`;
    }

    const engagementInfo = post.engagement
        ? ` | 👍 ${post.engagement.reactions} · 💬 ${post.engagement.comments}`
        : '';

    // Add engagement score if available
    const scoreInfo = post.engagementScore
        ? ` <span class="score-badge">Score: ${post.engagementScore}</span>`
        : '';

    document.getElementById('post-author-name').innerHTML = authorInfo + `<span class="engagement-badge">${engagementInfo}${scoreInfo}</span>`;
    document.getElementById('post-preview').textContent = post.preview;

    // Show hashtags if present
    let postPreviewHtml = post.preview;
    if (post.hashtags && post.hashtags.length > 0) {
        postPreviewHtml += `<div class="hashtags">${post.hashtags.slice(0, 5).join(' ')}</div>`;
    }

    // Show topic spaces if inferred
    if (post.topicSpaces && post.topicSpaces.length > 0) {
        postPreviewHtml += `<div class="topics">Topics: ${post.topicSpaces.join(', ')}</div>`;
    }

    // Show audience insights if available
    if (typeof window.AudienceInference !== 'undefined') {
        const audience = window.AudienceInference.inferAudience({ authorHeadline: post.authorHeadline }, post);
        postPreviewHtml += `<div class="audience-insight">
            <strong>Audience:</strong> ${audience.professionalRole} • ${audience.industry}<br>
            <strong>Tone:</strong> ${audience.recommendedTone}
        </div>`;
    }

    document.getElementById('post-preview').innerHTML = postPreviewHtml;

    // Update comment options
    const commentOptions = document.getElementById('comment-options');
    commentOptions.innerHTML = '';

    if (commentsData && commentsData.comments && commentsData.comments.length > 0) {
        commentsData.comments.forEach((comment, idx) => {
            const optionDiv = document.createElement('div');
            optionDiv.className = 'comment-option';
            optionDiv.innerHTML = `
                <input type="radio" name="comment-choice" id="comment-${idx}" value="${idx}">
                <label for="comment-${idx}">${comment}</label>
            `;

            optionDiv.addEventListener('click', () => {
                // Select this option
                document.querySelectorAll('.comment-option').forEach(el => el.classList.remove('selected'));
                optionDiv.classList.add('selected');
                optionDiv.querySelector('input').checked = true;

                // Update edit field
                bulkState.selectedComment = comment;
                document.getElementById('comment-edit').value = comment;
            });

            commentOptions.appendChild(optionDiv);
        });

        // Auto-select first option
        const firstOption = commentOptions.querySelector('.comment-option');
        if (firstOption) {
            firstOption.click();
        }
    } else {
        commentOptions.innerHTML = '<p class="text-sm text-gray-500">No comments generated for this post.</p>';
        document.getElementById('comment-edit').value = '';
        bulkState.selectedComment = '';
    }

    // Scroll post into view on LinkedIn
    scrollToPostOnLinkedIn(post.index);
}

/**
 * Scroll to post on LinkedIn page
 */
async function scrollToPostOnLinkedIn(postIndex) {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        await chrome.tabs.sendMessage(tab.id, { action: 'scrollToPost', postIndex });
    } catch (error) {
        console.error('Error scrolling to post:', error);
    }
}

/**
 * Save a sent comment to history for learning patterns (enhanced with audience data)
 */
async function saveCommentToHistory(post, comment) {
    // Auto-log metrics to Supabase (Sprint 7)
    await logCommentMetric(post, comment);

    const historyEntry = {
        id: `comment-${Date.now()}`,
        timestamp: new Date().toISOString(),

        // Post data
        postId: post.id,
        postAuthor: post.author,
        postAuthorHeadline: post.authorHeadline || '',
        postAuthorProfileUrl: post.authorProfileUrl || '',
        postContent: post.text,
        postPreview: post.preview,
        postHashtags: post.hashtags || [],
        postEngagement: post.engagement || { reactions: 0, comments: 0 },

        // Comment data
        commentSent: comment,
        commentLength: comment.length,

        // For future A/B testing - can be set by variant system
        commentVariant: 'default',

        // Tracking placeholder (updated later by impression tracker)
        tracking: {
            reactions: 0,
            replies: 0,
            lastChecked: null
        }
    };

    return new Promise((resolve) => {
        chrome.storage.local.get(['commentHistory'], (result) => {
            const history = result.commentHistory || [];
            history.unshift(historyEntry); // Add to beginning

            // Keep only last 500 entries to avoid storage limits
            const trimmedHistory = history.slice(0, 500);

            chrome.storage.local.set({ commentHistory: trimmedHistory }, async () => {
                console.log('Comment saved to local history:', historyEntry);

                // Also save to Supabase if configured
                if (typeof window.SupabaseClient !== 'undefined' && window.SupabaseClient.isConfigured()) {
                    try {
                        await window.SupabaseClient.saveComment(historyEntry);
                        console.log('Comment also saved to Supabase');

                        // Refresh global metrics display after save
                        loadGoalsDashboard();
                    } catch (err) {
                        console.warn('Supabase save failed (local backup retained):', err);
                    }
                }

                resolve(historyEntry);
            });
        });
    });
}

/**
 * Send comment to current post
 */
async function sendComment() {
    const sendBtn = document.getElementById('send-btn');
    const comment = bulkState.selectedComment.trim();

    if (!comment) {
        alert('Please select or write a comment first.');
        return;
    }

    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending...';

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const post = bulkState.posts[bulkState.currentIndex];

        // Use post.id (URN) for reliable matching after scrolling
        const response = await chrome.tabs.sendMessage(tab.id, {
            action: 'injectComment',
            postId: post.id,
            comment: comment,
            autoSubmit: true
        });

        if (response.success) {
            bulkState.sentCount++;
            sendBtn.textContent = '✅ Sent!';

            // Save to comment history
            await saveCommentToHistory(post, comment);

            setTimeout(() => {
                moveToNextPost();
            }, 1000);
        } else {
            sendBtn.textContent = 'Send Comment →';
            alert(`Error: ${response.message}`);
        }
    } catch (error) {
        console.error('Send error:', error);
        sendBtn.textContent = 'Send Comment →';
        alert('Error sending comment. Make sure you\'re on the LinkedIn page.');
    } finally {
        sendBtn.disabled = false;
    }
}

/**
 * Move to next post in carousel
 */
function moveToNextPost() {
    const sendBtn = document.getElementById('send-btn');
    sendBtn.textContent = 'Send Comment →';

    if (bulkState.currentIndex < bulkState.posts.length - 1) {
        bulkState.currentIndex++;
        displayCurrentPost();
    } else {
        // All posts done
        showBulkResults();
    }
}

/**
 * Show bulk mode results summary
 */
function showBulkResults() {
    const carouselContainer = document.getElementById('carousel-container');
    const bulkResults = document.getElementById('bulk-results');
    const bulkSummary = document.getElementById('bulk-summary');

    carouselContainer.classList.add('hidden');
    bulkResults.classList.remove('hidden');

    bulkSummary.textContent = `🎉 Done! Sent: ${bulkState.sentCount} | Skipped: ${bulkState.skippedCount}`;
}

/**
 * Reset bulk mode state
 */
function resetBulkMode() {
    bulkState = {
        isActive: false,
        posts: [],
        comments: [],
        currentIndex: 0,
        selectedComment: '',
        sentCount: 0,
        skippedCount: 0
    };

    document.getElementById('carousel-container').classList.add('hidden');
    document.getElementById('bulk-results').classList.add('hidden');
    document.getElementById('linkedin-check').textContent = 'Ready to scan feed.';
}

// ==================== OUTREACH MODE ====================

let currentOutreachPlan = null;

/**
 * Initialize outreach tab
 */
async function initOutreachTab() {
    const searchBtn = document.getElementById('search-creators-btn');
    const applyBtn = document.getElementById('apply-watchlist-btn');
    const exportBtn = document.getElementById('export-plan-btn');

    // Only add listeners once
    if (!searchBtn.dataset.initialized) {
        searchBtn.addEventListener('click', searchCreators);
        applyBtn?.addEventListener('click', applyToWatchlist);
        exportBtn?.addEventListener('click', exportOutreachPlan);
        searchBtn.dataset.initialized = 'true';
    }

    // Load saved plans
    await loadSavedPlans();
}

/**
 * Search for power creators
 */
async function searchCreators() {
    const nicheInput = document.getElementById('niche-input');
    const countSelect = document.getElementById('creator-count');
    const loader = document.getElementById('outreach-loader');
    const resultsDiv = document.getElementById('outreach-results');
    const searchBtn = document.getElementById('search-creators-btn');

    const niche = nicheInput.value.trim();
    if (!niche) {
        alert('Please enter a target niche/industry');
        return;
    }

    const count = parseInt(countSelect.value);

    searchBtn.disabled = true;
    loader.classList.remove('hidden');
    resultsDiv.classList.add('hidden');

    try {
        if (typeof window.OutreachSearch === 'undefined') {
            throw new Error('OutreachSearch library not loaded');
        }

        const planData = await window.OutreachSearch.searchPowerCreators(niche, count);

        if (planData.error || !planData.creators || planData.creators.length === 0) {
            throw new Error('No creators found. Try a different niche.');
        }

        currentOutreachPlan = planData;
        displayCreatorResults(planData);

        // Save plan
        await window.OutreachSearch.saveOutreachPlan(planData);
        await loadSavedPlans();

    } catch (error) {
        console.error('Outreach search error:', error);
        alert('Error searching: ' + error.message);
    } finally {
        loader.classList.add('hidden');
        searchBtn.disabled = false;
    }
}

/**
 * Display creator search results
 */
function displayCreatorResults(planData) {
    const resultsDiv = document.getElementById('outreach-results');
    const resultsCount = document.getElementById('results-count');
    const creatorList = document.getElementById('creator-list');

    resultsCount.textContent = `${planData.creators.length} creators found in "${planData.niche}"`;

    creatorList.innerHTML = planData.creators.map((creator, index) => {
        const themes = (creator.themes || []).slice(0, 4).map(t =>
            `<span class="theme-pill">${t}</span>`
        ).join('');

        const isTop10 = index < 10;

        return `
            <div class="creator-card ${isTop10 ? 'top-10' : ''}">
                <div class="creator-header">
                    <span class="creator-rank">${creator.rank}. ${creator.name}</span>
                    <span class="creator-score">${creator.score}/25</span>
                </div>
                <div class="creator-role">${creator.role} at ${creator.company}</div>
                <div class="creator-themes">${themes}</div>
                ${creator.commentAngles ? `
                <div class="creator-angles">
                    <div class="angle-item"><span class="angle-type">🔧 Operator:</span> ${creator.commentAngles.operator}</div>
                    <div class="angle-item"><span class="angle-type">🤔 Contrarian:</span> ${creator.commentAngles.contrarian}</div>
                    <div class="angle-item"><span class="angle-type">❓ Question:</span> ${creator.commentAngles.question}</div>
                </div>
                ` : ''}
            </div>
        `;
    }).join('');

    resultsDiv.classList.remove('hidden');
}

/**
 * Apply current plan to watchlist
 */
async function applyToWatchlist() {
    if (!currentOutreachPlan) {
        alert('No plan to apply');
        return;
    }

    const watchlist = window.OutreachSearch.convertToWatchlistFormat(currentOutreachPlan);

    await new Promise(resolve => {
        chrome.storage.local.set({ customWatchlist: watchlist }, resolve);
    });

    alert(`✅ Applied ${watchlist.length} creators to your watchlist!`);
}

/**
 * Export current plan as markdown
 */
function exportOutreachPlan() {
    if (!currentOutreachPlan) {
        alert('No plan to export');
        return;
    }

    const markdown = window.OutreachSearch.exportPlanAsMarkdown(currentOutreachPlan);

    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `outreach-plan-${currentOutreachPlan.niche.replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
}

/**
 * Load saved outreach plans
 */
async function loadSavedPlans() {
    const savedList = document.getElementById('saved-plans-list');

    if (typeof window.OutreachSearch !== 'undefined') {
        const plans = await window.OutreachSearch.getOutreachPlans();

        if (plans.length === 0) {
            savedList.innerHTML = '<p class="text-sm text-gray-500">No saved plans yet</p>';
            return;
        }

        savedList.innerHTML = plans.map(plan => {
            const date = new Date(plan.savedAt).toLocaleDateString();
            return `
                <div class="saved-plan-item" data-plan-id="${plan.id}">
                    <span class="plan-niche">${plan.niche} (${plan.creators?.length || 0} creators)</span>
                    <span class="plan-date">${date}</span>
                </div>
            `;
        }).join('');

        // Add click handlers
        savedList.querySelectorAll('.saved-plan-item').forEach(item => {
            item.addEventListener('click', () => {
                const planId = item.dataset.planId;
                const plan = plans.find(p => p.id === planId);
                if (plan) {
                    currentOutreachPlan = plan;
                    displayCreatorResults(plan);
                }
            });
        });
    }
}

// ==================== AUTO-FIND & COMMENT (Sprint 6) ====================

/**
 * Auto-find watchlist posts and generate comments
 */
async function autoFindAndComment() {
    const bulkLoader = document.getElementById('bulk-loader');
    const linkedinCheck = document.getElementById('linkedin-check');
    const autoFindBtn = document.getElementById('auto-find-btn');

    autoFindBtn.disabled = true;
    bulkLoader.classList.remove('hidden');
    linkedinCheck.textContent = '⚡ Searching for watchlist posts...';

    try {
        if (typeof window.LinkedInSearch === 'undefined') {
            throw new Error('LinkedInSearch library not loaded');
        }

        const result = await window.LinkedInSearch.findAndComment();

        if (!result.success) {
            throw new Error(result.message);
        }

        if (result.posts.length === 0) {
            linkedinCheck.textContent = '📭 No watchlist posts found. Try scrolling feed.';
            return;
        }

        // Load posts with pre-generated comments into carousel
        bulkState.posts = result.posts;
        bulkState.isActive = true;
        bulkState.currentIndex = 0;

        // Pre-populate comments array from generated comments
        bulkState.comments = result.posts.map(post => {
            if (post.generatedComments && post.generatedComments.length > 0) {
                return post.generatedComments.map(c => c.text);
            }
            return [];
        });

        linkedinCheck.textContent = `⚡ Found ${result.stats.matched} watchlist posts with comments ready!`;

        // Show carousel with first post
        showPostInCarousel(0);

    } catch (error) {
        console.error('Auto-find error:', error);
        linkedinCheck.textContent = '❌ ' + error.message;
    } finally {
        bulkLoader.classList.add('hidden');
        autoFindBtn.disabled = false;
    }
}

// ==================== GOALS DASHBOARD (Sprint 7) ====================

/**
 * Load Goals Dashboard
 */
async function loadGoalsDashboard() {
    const globalProgress = document.getElementById('global-goals-progress');
    const goalsStatus = document.getElementById('goals-status-message');
    const goalsForm = document.querySelector('.goals-settings');

    if (typeof window.SupabaseClient === 'undefined' || !window.SupabaseClient.isConfigured()) {
        if (goalsStatus) {
            goalsStatus.innerHTML = `
                <div class="p-4 text-center">
                    <p class="text-sm text-gray-500 mb-2">Configure Supabase in settings to track metrics.</p>
                    <p class="text-xs text-blue-500">Analytics are currently disabled.</p>
                </div>
            `;
            goalsStatus.classList.remove('hidden');
        }
        if (goalsForm) goalsForm.classList.add('hidden');
        if (globalProgress) globalProgress.classList.add('hidden');
        return;
    }

    if (goalsStatus) goalsStatus.classList.add('hidden');
    if (goalsForm) goalsForm.classList.remove('hidden');
    if (globalProgress) globalProgress.classList.remove('hidden');

    // Load goals first
    const goals = await window.SupabaseClient.getWeeklyGoals();
    if (goals) {
        const commentsInput = document.getElementById('goal-comments');
        const watchlistInput = document.getElementById('goal-watchlist');
        const hValueInput = document.getElementById('goal-high-value');
        const respRateInput = document.getElementById('goal-response-rate');

        if (commentsInput) commentsInput.value = goals.comments_target;
        if (watchlistInput) watchlistInput.value = goals.watchlist_target;
        if (hValueInput) hValueInput.value = goals.high_value_target;
        if (respRateInput) respRateInput.value = Math.round(goals.response_rate_target * 100);
    }

    // Load daily metrics
    const daily = await window.SupabaseClient.getDailyMetrics();
    if (daily) {
        const todayComments = document.getElementById('today-comments');
        const todayWatchlist = document.getElementById('today-watchlist');
        const todayHighValue = document.getElementById('today-high-value');

        if (todayComments) todayComments.textContent = daily.comments_sent;
        if (todayWatchlist) todayWatchlist.textContent = daily.watchlist_comments;
        if (todayHighValue) todayHighValue.textContent = daily.high_value_comments;
    }

    // Load weekly metrics
    const weekly = await window.SupabaseClient.getWeeklyMetrics();
    const targets = goals || {
        comments_target: 100,
        watchlist_target: 50,
        high_value_target: 30,
        response_rate_target: 0.30
    };

    if (weekly) {
        // Update all 4 weekly bars
        const bars = [
            { id: 'week-comments', current: weekly.total_comments, target: targets.comments_target, isPercent: false },
            { id: 'week-watchlist', current: weekly.total_watchlist, target: targets.watchlist_target, isPercent: false },
            { id: 'week-high-value', current: weekly.total_high_value, target: targets.high_value_target, isPercent: false },
            { id: 'week-response', current: weekly.avg_response_rate, target: Math.round(targets.response_rate_target * 100), isPercent: true }
        ];

        bars.forEach(bar => {
            const textEl = document.getElementById(`${bar.id}-text`);
            const barEl = document.getElementById(`${bar.id}-bar`);

            if (textEl) {
                textEl.textContent = bar.isPercent ?
                    `${Math.round(bar.current || 0)}%` :
                    `${bar.current || 0} / ${bar.target}`;
            }

            if (barEl) {
                const percent = bar.target > 0 ? Math.min(100, ((bar.current || 0) / bar.target) * 100) : 0;
                barEl.style.width = `${percent}%`;

                // Color coding
                if (percent >= 100) barEl.style.background = '#10b981';
            }
        });
    }

    // Load watchlist performance
    const performance = await window.SupabaseClient.getWatchlistPerformance();
    const perfDiv = document.getElementById('watchlist-perf');
    if (performance && performance.length > 0) {
        perfDiv.innerHTML = performance.map(creator => {
            const stars = '⭐'.repeat(Math.round(creator.engagement_score));
            return `
                <div class="creator-perf-item">
                    <div class="creator-perf-name">${creator.creator_name}</div>
                    <div class="creator-perf-stats">
                        <span>${creator.comments_sent} comments</span>
                        <span>${creator.replies_received} replies</span>
                        <span class="creator-perf-score">${stars}</span>
                    </div>
                </div>
            `;
        }).join('');
    } else {
        perfDiv.innerHTML = '<p class="text-sm text-gray-500">No watchlist data yet</p>';
    }

    // Generate recommendations
    generateRecommendations(weekly, targets, daily);

    // Wire up save button
    document.getElementById('save-goals-btn').onclick = saveGoals;
}

/**
 * Save weekly goals
 */
async function saveGoals() {
    const goals = {
        commentsTarget: parseInt(document.getElementById('goal-comments').value),
        watchlistTarget: parseInt(document.getElementById('goal-watchlist').value),
        highValueTarget: parseInt(document.getElementById('goal-high-value').value),
        responseRateTarget: parseInt(document.getElementById('goal-response-rate').value) / 100
    };

    const result = await window.SupabaseClient.setWeeklyGoals(goals);
    if (result) {
        alert('✅ Goals saved successfully!');
        loadGoalsDashboard(); // Reload to update progress bars
    } else {
        alert('❌ Failed to save goals. Check Supabase connection.');
    }
}

/**
 * Generate recommendations based on metrics
 */
function generateRecommendations(weekly, targets, daily) {
    const recommendations = [];

    if (!weekly || !daily) {
        document.getElementById('recommendations').innerHTML =
            '<p class="text-sm text-gray-500">No data yet. Start commenting!</p>';
        return;
    }

    // Check if behind on weekly goal
    const daysIntoWeek = new Date().getDay() || 7; // Sunday = 7
    const expectedComments = (targets.comments_target / 7) * daysIntoWeek;
    if (weekly.total_comments < expectedComments * 0.8) {
        const needed = Math.ceil(targets.comments_target - weekly.total_comments);
        recommendations.push({
            type: 'warning',
            text: `⚡ PRIORITY: Need ${needed} more comments to hit weekly goal`
        });
    }

    // Check daily quota
    if (daily.comments_sent < 10) {
        recommendations.push({
            type: 'info',
            text: `📊 Send ${10 - daily.comments_sent} more comments today to stay on track`
        });
    }

    // Check high-value comments
    const highValueRatio = weekly.total_high_value / (weekly.total_comments || 1);
    if (highValueRatio < 0.25) {
        recommendations.push({
            type: 'warning',
            text: `📈 BOOST: High-value comments below target - aim for frameworks/stories (40+ words)`
        });
    }

    // Check response rate
    if (weekly.avg_response_rate < targets.response_rate_target * 100 * 0.8) {
        recommendations.push({
            type: 'warning',
            text: `💬 IMPROVE: Response rate low - try different comment styles or better targeting`
        });
    }

    // Success messages
    if (weekly.total_comments >= targets.comments_target) {
        recommendations.push({
            type: 'success',
            text: `🎉 AMAZING: You hit your weekly goal! Consider going for ${Math.ceil(targets.comments_target * 1.2)}`
        });
    }

    if (weekly.avg_response_rate >= targets.response_rate_target * 100) {
        recommendations.push({
            type: 'success',
            text: `✅ EXCELLENT: Response rate above target! Your comments are resonating.`
        });
    }

    const recDiv = document.getElementById('recommendations');
    if (recommendations.length > 0) {
        recDiv.innerHTML = recommendations.map(rec => `
            <div class="recommendation-item ${rec.type}">
                ${rec.text}
            </div>
        `).join('');
    } else {
        recDiv.innerHTML = '<p class="text-sm text-gray-500">All on track! Keep up the great work 🚀</p>';
    }
}

/**
 * Auto-log comment metric when comment is sent
 * Call this from sendCommentToLinkedIn
 */
async function logCommentMetric(post, comment) {
    if (typeof window.SupabaseClient === 'undefined' || !window.SupabaseClient.isConfigured()) {
        return; // Skip if Supabase not configured
    }

    // Determine if watchlist comment
    const isWatchlist = post.isWatchlist || false;

    // Determine if high-value (40+ words)
    const wordCount = comment.split(/\s+/).length;
    const isHighValue = wordCount >= 40;

    // Log to daily metrics
    await window.SupabaseClient.logDailyMetric({
        commentsSent: 1,
        watchlistComments: isWatchlist ? 1 : 0,
        highValueComments: isHighValue ? 1 : 0
    });

    // If watchlist, also log to watchlist performance
    if (isWatchlist && post.authorName) {
        await window.SupabaseClient.logWatchlistEngagement(post.authorName, false);
    }
}

/* --- Authentication Handlers (Sprint 8) --- */

/**
 * Update UI state based on current authentication session
 */
async function refreshAuthStatus() {
    if (typeof window.SupabaseClient === 'undefined') return;

    try {
        const session = await window.SupabaseClient.getSession();
        if (session && session.user) {
            if (userEmailDisplay) userEmailDisplay.textContent = session.user.email;
            if (authActionBtn) {
                authActionBtn.textContent = 'Logout';
                authActionBtn.classList.add('secondary');
            }
        } else {
            if (userEmailDisplay) userEmailDisplay.textContent = 'Anonymous';
            if (authActionBtn) {
                authActionBtn.textContent = 'Sign In';
                authActionBtn.classList.remove('secondary');
            }
        }
    } catch (err) {
        console.error('Error refreshing auth status:', err);
    }
}

/**
 * Handle Sign In / Logout button click
 */
function handleAuthAction() {
    if (authActionBtn.textContent === 'Logout') {
        window.SupabaseClient.signOut().then(() => {
            refreshAuthStatus();
            loadGoalsDashboard(); // Refresh dashboard to show anonymous state or prompt
        });
    } else {
        if (authOverlay) {
            authOverlay.classList.remove('hidden');
            showAuthStep('email');
        }
    }
}

/**
 * Switch between Email and OTP steps in the login modal
 */
function showAuthStep(step) {
    if (authMessage) authMessage.classList.add('hidden');
    if (step === 'email') {
        if (authStepEmail) authStepEmail.classList.remove('hidden');
        if (authStepOtp) authStepOtp.classList.add('hidden');
    } else {
        if (authStepEmail) authStepEmail.classList.add('hidden');
        if (authStepOtp) authStepOtp.classList.remove('hidden');
    }
}

/**
 * Send Magic Link / OTP to user's email
 */
/**
 * Simplified Identity (No OTP)
 */
async function handleIdentify() {
    if (!authEmailInput) return;
    const email = authEmailInput.value.trim();
    if (!email || !email.includes('@')) {
        showAuthError('Please enter a valid email address.');
        return;
    }

    try {
        setAuthLoading(true);
        const user = await window.SupabaseClient.identify(email);
        if (user) {
            if (authOverlay) authOverlay.classList.add('hidden');
            await refreshAuthStatus();
            await loadGoalsDashboard();
        }
    } catch (err) {
        console.error('Identity error:', err);
        const errorMsg = err.message.includes('not initialized')
            ? 'Supabase is still initializing. Please wait a second and try again.'
            : 'Failed to sync. Please check your connection.';
        showAuthError(errorMsg);
    } finally {
        setAuthLoading(false);
    }
}

// Map the old sendOtpBtn to handleIdentify
function handleSendOtp() {
    handleIdentify();
}

/**
 * Verify the OTP token (Stubbed out for simple identity)
 */
async function handleVerifyOtp() {
    // No longer used in simplified flow
}

/**
 * Display error message in the auth modal
 */
function showAuthError(msg) {
    if (authMessage) {
        authMessage.textContent = msg;
        authMessage.classList.remove('hidden');
    }
}

/**
 * Show/hide loading state during auth operations
 */
function setAuthLoading(loading) {
    if (authLoader) authLoader.classList.toggle('hidden', !loading);
    if (sendOtpBtn) sendOtpBtn.disabled = loading;
    if (verifyOtpBtn) verifyOtpBtn.disabled = loading;
}


