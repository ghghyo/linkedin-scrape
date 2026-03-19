# LinkedIn Commenting Workflow Guide

## 🚀 Quick Start: Using the Chrome Extension for Daily Commenting

### Setup (One-Time)

1. **Install the Extension** (if not already done)
   - Open Chrome → Navigate to `chrome://extensions/`
   - Enable "Developer mode" (top-right toggle)
   - Click "Load unpacked" → Select the `commenter` folder
   - Pin the extension to your toolbar

2. **Configure Your API Key**
   - Click the extension icon
   - Enter your Google Gemini API key ([Get one free here](https://aistudio.google.com/app/apikey))
   - Test and save

3. **Select Your Comment Style**
   - Click "Set System Prompt"
   - Choose your preferred style:
     - **TechNovaTime LinkedIn** (Default) - Professional tech industry
     - **General LinkedIn Comments** - Versatile professional
     - **Tech Industry Leader** - Leadership-focused
   - Click "Use This Prompt"

---

## 📋 Daily Workflow (15 minutes/day)

### Step 1: Open Your Watchlist
Use the [daily-commenting-execution-checklist.md](./daily-commenting-execution-checklist.md) to:
- Check your Top 10 healthcare AI creators
- Check high-engagement creators (Huberman, Jocko, Sinek, etc.)
- Open 5-10 creator profiles in separate browser tabs

### Step 2: Find High-Value Posts
For each creator:
- Go to their `/recent-activity/all/` page
- Look for posts with **50+ reactions** from the **last 24-48 hours**
- Posts with <100 comments = better visibility for your comment

### Step 3: Generate Comments (Using Extension)
For each post you want to comment on:

1. **Read the post** and determine if you have genuine value to add
2. **Highlight the post text** (click and drag to select)
3. **Open the extension**:
   - Click the extension icon in toolbar, OR
   - Press `Ctrl+Q` keyboard shortcut
4. **Review the 3 auto-generated comments**
5. **Copy your favorite** (click "Copy" button)
6. **Paste into LinkedIn** comment box and post

### Step 4: Track Your Engagement
Keep a simple spreadsheet with:
- Date, Creator Name, Post URL, Your Comment, Response (Y/N)
- Review weekly to see which creators engage most

### Step 5: Follow Up
- Check LinkedIn notifications 2x/day (morning & afternoon)
- Reply to anyone who responds within 2 hours
- Build relationships with creators who consistently engage

---

## 🎯 Best Practices

### Quality Over Quantity
✅ **Do:**
- Comment on 3-5 best posts daily (not 20+ mediocre ones)
- Add genuine insights based on your experience
- Engage where you have operator/founder/technical expertise
- Reply to responses within 24 hours

❌ **Don't:**
- Copy-paste generic comments
- Comment on everything
- Ignore replies to your comments

### Optimize for Visibility
- **Timing**: Comment on posts <24 hours old
- **Engagement**: Target posts with 50-500 reactions (sweet spot)
- **Comment Count**: <100 comments = your comment will be seen
- **Follow-Up**: Monitor notifications and engage with replies

### Comment Structure (Extension Does This)
The extension follows the proven 3-part formula:
1. **Open with insight** (personal experience, operator perspective)
2. **Add concrete value** (framework, example, metric)
3. **End with a question** (drives replies and engagement)

Comments are kept **≤500 characters** for maximum impact.

---

## 🔧 Troubleshooting

**"No text highlighted" error**
- Make sure you've selected/highlighted the post text before clicking the extension
- Try clicking directly on the post text area

**Comments feel generic**
- Switch to a different system prompt that matches your voice
- Create a custom prompt in the extension settings

**Low engagement on your comments**
- Review your checklist - are you targeting the right creators?
- Check timing - comment on fresher posts (<24 hours)
- Add more personal insight before the AI-generated comment

**Extension not working**
- Verify API key is set (click extension → check status)
- Check internet connection
- Reload the extension from `chrome://extensions/`

---

## 📊 Weekly Review (15 min every Friday)

1. **Analyze what worked**:
   - Which creators responded most?
   - Which topics got the most replies?
   - Which comment style performed best?

2. **Update your watchlist**:
   - Add high-response creators to daily list
   - Remove creators who never engage
   - Use the search queries in the checklist to find new voices

3. **Refine your approach**:
   - Double down on winning topics and creators
   - Adjust comment angles based on what resonates

---

## 📁 Files in This Repo

- **[daily-commenting-execution-checklist.md](./daily-commenting-execution-checklist.md)** - Your step-by-step daily workflow with exact creator URLs
- **[commenting-plan.md](./commenting-plan.md)** - Full strategy research and creator insights
- **background.js** - Extension backend (handles API calls)
- **popup.js** - Extension UI and logic
- **prompts/** - Pre-built system prompts for different commenting styles
- **lib/** - Helper libraries (audience inference, smart prompts)

---

## 🎓 Pro Tips

1. **Batch Processing**: Open all watchlist profiles in tabs once, then go through them sequentially
2. **Keyboard Shortcuts**: `Ctrl+Q` to open extension instantly
3. **Save Winners**: When a comment gets great engagement, save it to refine your prompts
4. **Build Relationships**: If someone responds 2+ times, send them a connection request
5. **Track Metrics**: Use the provided spreadsheet template to measure response rates

---

**Goal**: Build authentic relationships with industry leaders through consistent, value-adding engagement. The tool automates comment generation, but **your insights and follow-up** build the relationships.
