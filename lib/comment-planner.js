/**
 * Comment Planner Library
 * Sprint 5: Generate strategic comment plans for creators
 * 
 * Creates tailored engagement strategies based on creator profiles
 */

// Comment angle templates
const COMMENT_ANGLES = {
    operator: {
        name: 'Operator Insight',
        description: 'Share practical, metrics-driven experience',
        prefix: 'In my experience building [X], I found that',
        examples: [
            'When we implemented this, we saw a 40% improvement in...',
            'The metrics that mattered most for us were...',
            'Our team tried this and discovered that...'
        ]
    },
    contrarian: {
        name: 'Respectful Contrarian',
        description: 'Challenge assumptions thoughtfully',
        prefix: 'I appreciate this perspective, but wonder if',
        examples: [
            'Have you considered the opposite might also be true?',
            'This resonates, though I\'ve seen cases where...',
            'Interesting - what about organizations where this pattern breaks?'
        ]
    },
    framework: {
        name: 'Micro-Framework',
        description: 'Provide 3-step actionable approach',
        prefix: 'This reminds me of a simple framework I use:',
        examples: [
            '1) Identify the friction 2) Automate the repetitive 3) Measure outcomes',
            'We break it into: Discover → Validate → Scale',
            'The 3 C\'s: Clarify the problem, Create the solution, Confirm it works'
        ]
    },
    story: {
        name: 'Story-Based',
        description: 'Brief personal anecdote',
        prefix: 'This reminds me of a situation where',
        examples: [
            'A colleague once faced exactly this challenge. Here\'s what happened...',
            'I remember when our team hit this same wall. We learned that...',
            'Similar story from a client: they tried [X] and discovered...'
        ]
    },
    question: {
        name: 'Question Hook',
        description: 'Thoughtful follow-up question',
        prefix: 'Great insight! I\'m curious:',
        examples: [
            'What\'s the biggest unexpected challenge you faced implementing this?',
            'How did you get buy-in from stakeholders initially skeptical of this approach?',
            'What metrics were most persuasive when advocating for this change?'
        ]
    }
};

// Note: TONE_MODIFIERS is defined in smart-prompts.js and used here

/**
 * Generate a complete comment plan for a set of creators
 */
function generateCommentPlan(creators, userContext = {}) {
    return creators.map((creator, index) => ({
        rank: index + 1,
        creator: {
            name: creator.name,
            role: creator.role,
            company: creator.company,
            themes: creator.themes
        },
        engagementStrategy: generateEngagementStrategy(creator, userContext),
        commentAngles: generateCreatorAngles(creator, userContext),
        monitoringTips: generateMonitoringTips(creator),
        bestTimes: suggestEngagementTimes(creator)
    }));
}

/**
 * Generate engagement strategy for a specific creator
 */
function generateEngagementStrategy(creator, userContext = {}) {
    const creatorType = inferCreatorType(creator);

    // Use TONE_MODIFIERS from SmartPrompts if available, otherwise use fallback
    const TONE_MODIFIERS = (typeof window !== 'undefined' && window.SmartPrompts?.TONE_MODIFIERS)
        ? window.SmartPrompts.TONE_MODIFIERS
        : {
            founder: { style: 'Direct, metrics-focused', avoid: 'Excessive flattery' },
            executive: { style: 'Strategic, business outcomes focused', avoid: 'Overly technical' },
            investor: { style: 'Market-aware, trend-focused', avoid: 'Pitchy content' },
            researcher: { style: 'Evidence-based', avoid: 'Oversimplification' },
            practitioner: { style: 'Practical, real-world examples', avoid: 'Abstract theory' }
        };

    const toneGuide = TONE_MODIFIERS[creatorType] || TONE_MODIFIERS['Professional'] || { style: 'Professional', avoid: 'Generic' };

    return {
        creatorType,
        tone: toneGuide.style || toneGuide,
        avoid: toneGuide.avoid || 'Generic comments',
        approach: generateApproachSuggestions(creator, creatorType),
        targetFrequency: suggestEngagementFrequency(creator),
        relationshipGoal: generateRelationshipGoal(creator)
    };
}

/**
 * Infer creator type from their profile
 */
function inferCreatorType(creator) {
    const role = (creator.role || '').toLowerCase();
    const themes = (creator.themes || []).join(' ').toLowerCase();

    if (role.includes('ceo') || role.includes('founder') || role.includes('co-founder')) {
        return 'founder';
    }
    if (role.includes('partner') || role.includes('investor') || role.includes('vc')) {
        return 'investor';
    }
    if (role.includes('cto') || role.includes('vp') || role.includes('director') || role.includes('chief')) {
        return 'executive';
    }
    if (role.includes('professor') || role.includes('researcher') || role.includes('scientist')) {
        return 'researcher';
    }
    return 'practitioner';
}

/**
 * Generate approach suggestions based on creator type
 */
function generateApproachSuggestions(creator, creatorType) {
    const suggestions = [];

    switch (creatorType) {
        case 'founder':
            suggestions.push('Share operational insights and metrics from your own work');
            suggestions.push('Ask about specific scaling challenges they\'ve overcome');
            suggestions.push('Offer complementary perspectives from adjacent spaces');
            break;
        case 'investor':
            suggestions.push('Discuss market trends and patterns you\'ve observed');
            suggestions.push('Ask about their investment thesis in this area');
            suggestions.push('Share insights about companies in their portfolio space');
            break;
        case 'executive':
            suggestions.push('Focus on business outcomes and ROI');
            suggestions.push('Discuss change management and adoption challenges');
            suggestions.push('Share enterprise perspective on their topics');
            break;
        case 'researcher':
            suggestions.push('Engage with their research and findings');
            suggestions.push('Ask clarifying questions about methodology');
            suggestions.push('Discuss practical applications of their work');
            break;
        default:
            suggestions.push('Share relevant experience and learnings');
            suggestions.push('Ask thoughtful follow-up questions');
            suggestions.push('Offer practical frameworks when appropriate');
    }

    return suggestions;
}

/**
 * Generate specific comment angles for a creator
 */
function generateCreatorAngles(creator, userContext = {}) {
    const themes = creator.themes || [];

    return {
        operator: {
            angle: creator.commentAngles?.operator ||
                `Share practical experience related to ${themes[0] || 'their focus area'}`,
            template: COMMENT_ANGLES.operator.examples[0]
        },
        contrarian: {
            angle: creator.commentAngles?.contrarian ||
                `Challenge assumptions around ${themes[1] || themes[0] || 'their thesis'}`,
            template: COMMENT_ANGLES.contrarian.examples[0]
        },
        framework: {
            angle: creator.commentAngles?.framework ||
                `Offer actionable model for ${themes[0] || 'their topic'}`,
            template: COMMENT_ANGLES.framework.examples[0]
        },
        story: {
            angle: creator.commentAngles?.story ||
                `Share relevant anecdote about ${themes[0] || 'similar situation'}`,
            template: COMMENT_ANGLES.story.examples[0]
        },
        question: {
            angle: creator.commentAngles?.question ||
                `Ask about implementation details of ${themes[0] || 'their approach'}`,
            template: COMMENT_ANGLES.question.examples[0]
        }
    };
}

/**
 * Generate monitoring tips for a creator
 */
function generateMonitoringTips(creator) {
    return [
        `Set notifications for ${creator.name}'s posts`,
        `Monitor their engagement with other creators in ${creator.themes?.[0] || 'the space'}`,
        `Track when they respond to comments (their active hours)`,
        `Watch for content about: ${(creator.themes || []).slice(0, 3).join(', ')}`
    ];
}

/**
 * Suggest engagement frequency based on creator engagement level
 */
function suggestEngagementFrequency(creator) {
    const engagement = (creator.engagement || 'Medium').toLowerCase();

    switch (engagement) {
        case 'high':
            return {
                frequency: '3-4x per week',
                note: 'High visibility means comments get seen, but competition is fierce. Be early and insightful.'
            };
        case 'medium':
            return {
                frequency: '2-3x per week',
                note: 'Good balance of visibility and ability to stand out. Focus on quality.'
            };
        default:
            return {
                frequency: '1-2x per week',
                note: 'Easier to build relationship through consistent engagement.'
            };
    }
}

/**
 * Suggest best times to engage
 */
function suggestEngagementTimes(creator) {
    return {
        optimal: 'First 30 minutes after post goes live',
        good: '1-4 hours after posting',
        avoid: 'After 24 hours (visibility drops significantly)',
        tip: 'Enable notifications for priority creators'
    };
}

/**
 * Generate relationship goal for creator
 */
function generateRelationshipGoal(creator) {
    const goals = [
        `Get noticed through consistent, thoughtful comments`,
        `Build familiarity so they recognize your name`,
        `Eventually earn a reply or direct engagement`,
        `Position for DM outreach or collaboration`
    ];

    return {
        shortTerm: goals[0],
        mediumTerm: goals[1] + ' → ' + goals[2],
        longTerm: goals[3]
    };
}

/**
 * Export comment plan as structured markdown
 */
function exportCommentPlanMarkdown(plan) {
    let md = `# Comment Engagement Plan\n\n`;
    md += `Generated: ${new Date().toLocaleString()}\n\n`;

    plan.forEach(entry => {
        md += `## ${entry.rank}. ${entry.creator.name}\n`;
        md += `**${entry.creator.role}** at ${entry.creator.company}\n\n`;

        md += `### Engagement Strategy\n`;
        md += `- **Type:** ${entry.engagementStrategy.creatorType}\n`;
        md += `- **Tone:** ${entry.engagementStrategy.tone}\n`;
        md += `- **Frequency:** ${entry.engagementStrategy.targetFrequency.frequency}\n`;
        md += `- **Avoid:** ${entry.engagementStrategy.avoid}\n\n`;

        md += `### Comment Angles\n`;
        Object.entries(entry.commentAngles).forEach(([key, value]) => {
            md += `- **${COMMENT_ANGLES[key].name}:** ${value.angle}\n`;
        });

        md += `\n### Monitoring\n`;
        entry.monitoringTips.forEach(tip => {
            md += `- ${tip}\n`;
        });

        md += `\n---\n\n`;
    });

    return md;
}

// Export for use in extension
if (typeof window !== 'undefined') {
    window.CommentPlanner = {
        COMMENT_ANGLES,
        generateCommentPlan,
        generateEngagementStrategy,
        generateCreatorAngles,
        inferCreatorType,
        exportCommentPlanMarkdown
    };
}
