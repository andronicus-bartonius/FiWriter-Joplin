/**
 * Prompt template system for FiRiter workflow nodes.
 *
 * Uses tagged template literal style with {{variable}} placeholders.
 * Built-in templates for the Outline → Scene Draft pipeline.
 */

// ============================================================
// Template Engine
// ============================================================

export function renderTemplate(template: string, vars: Record<string, string>): string {
	return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
		return vars[key] !== undefined ? vars[key] : `{{${key}}}`;
	});
}

// ============================================================
// System Prompts
// ============================================================

export const SYSTEM_SCREENWRITER = `You are a professional screenwriter and story consultant. You write vivid, emotionally resonant scenes with sharp dialogue and purposeful action. You follow established story canon precisely and never contradict world rules or character histories unless explicitly asked.`;

export const SYSTEM_CONTINUITY_CHECKER = `You are a meticulous continuity editor. Your job is to compare a draft scene against established canon facts and world rules. Report every contradiction, no matter how small. Be precise and cite specific facts.`;

export const SYSTEM_EVALUATOR = `You are a script editor evaluating a scene draft for quality. Assess format correctness, beat coverage, pacing, tone consistency, and dialogue quality. Provide a structured evaluation with a pass/fail verdict and specific improvement suggestions.`;

export const SYSTEM_BRAINSTORMER = `You are a creative story consultant specializing in plot structure and beat sheets. You generate bold, surprising, emotionally resonant story beats. You respect the established canon while pushing creative boundaries. Always ground suggestions in character motivation and thematic coherence.`;

export const SYSTEM_DIALOGUE_COACH = `You are a dialogue specialist and voice coach. You analyze character speech patterns, refine dialogue for authenticity, and ensure each character has a distinct voice. You pay attention to subtext, rhythm, power dynamics, and emotional undercurrents in conversation.`;

export const SYSTEM_CONTINUITY_AUDITOR = `You are an obsessive continuity auditor for a complex narrative. You cross-reference every detail against the canon database, flagging inconsistencies, timeline errors, contradictions, and loose threads. You propose concrete fixes with minimal disruption to the existing text.`;

// ============================================================
// Outline → Scene Draft Templates
// ============================================================

export const TEMPLATES = {
	identifyContext: `Analyze the following outline/selection and identify:
1. The scope (world, season, episode, scene)
2. Key characters involved
3. Key locations referenced
4. Relevant story arcs and threads
5. Any items or rules that apply

Outline/Selection:
{{outline}}

Pinned entities from storyboard:
{{pinnedEntities}}

Return a JSON object with arrays: characters, locations, arcs, rules, items.`,

	gatherConstraints: `Given these entities from the knowledge graph, summarize the active constraints and rules that must be respected in the upcoming scene draft.

Entities and their current state:
{{entityDetails}}

World rules in scope:
{{worldRules}}

Character states at this point:
{{characterStates}}

Summarize the constraints as a numbered list. Each constraint should reference its source entity.`,

	generateDraft: `Write a scene draft based on the following inputs.

## Scene Outline
{{outline}}

## Constraints (must not violate)
{{constraints}}

## Character Voice & Style Reference
{{ragSnippets}}

## Entity Context
{{entityContext}}

## Additional Instructions
{{userInstructions}}

Write the scene in standard screenplay/prose format. Include action lines, dialogue with character names, and scene transitions as appropriate. Stay within the established canon.`,

	continuityCheck: `Compare the following draft scene against the established canon constraints. Report any contradictions.

## Draft Scene
{{draft}}

## Active Constraints
{{constraints}}

## Entity Details
{{entityDetails}}

For each contradiction found, output a JSON array of objects:
[{ "fact": "the canon fact", "violation": "what the draft says", "severity": "major|minor", "suggestion": "how to fix" }]

If no contradictions are found, return an empty array: []`,

	proposeDeltas: `Analyze this scene draft and identify any NEW facts, state changes, or relationships that it introduces. These are potential updates to the story canon.

## Draft Scene
{{draft}}

## Known Entity States
{{entityDetails}}

For each new fact or change, output a JSON array:
[{ "entityName": "name", "entityType": "Character|Location|Item|etc", "change": "description of new fact or state change", "confidence": "high|medium|low" }]

If no new facts are introduced, return: []`,

	reviseDraft: `Revise the following scene draft to fix the continuity issues listed below. Preserve as much of the original draft as possible while correcting the violations.

## Original Draft
{{draft}}

## Contradictions to Fix
{{contradictions}}

## Active Constraints
{{constraints}}

Write the revised scene. Only change what is necessary to resolve the contradictions.`,

	evaluateOutput: `Evaluate this scene draft against the following criteria. Return a JSON object.

## Scene Draft
{{draft}}

## Original Outline
{{outline}}

## Evaluation Criteria
1. **Format**: Is it properly formatted as a screenplay/prose scene?
2. **Beat Coverage**: Does it cover all the beats from the outline?
3. **Length**: Is the length appropriate for the scope (not too short, not too long)?
4. **Tone**: Is the tone consistent with the story's established voice?
5. **Dialogue**: Is dialogue natural and character-appropriate?

Return JSON:
{
  "pass": true/false,
  "score": 0-100,
  "format": { "pass": true/false, "notes": "..." },
  "beatCoverage": { "pass": true/false, "coveredBeats": [...], "missedBeats": [...] },
  "length": { "pass": true/false, "wordCount": N, "notes": "..." },
  "tone": { "pass": true/false, "notes": "..." },
  "dialogue": { "pass": true/false, "notes": "..." },
  "suggestions": ["..."]
}`,
	// ============================================================
	// Brainstorming Beats Templates
	// ============================================================

	brainstormAnalyze: `Analyze the following story context and identify the current narrative state.

## Story Context / Premise
{{premise}}

## Known Characters
{{characters}}

## Known Arcs & Threads
{{arcs}}

## World Rules
{{worldRules}}

Summarize the current story state: where are the characters emotionally, what conflicts are active, and what unresolved threads exist? Return as a structured summary.`,

	brainstormGenerate: `Generate {{count}} possible story beats for the next section of this narrative.

## Current Story State
{{storyState}}

## Tone / Genre
{{tone}}

## User Direction
{{userDirection}}

## Constraints (cannot violate)
{{constraints}}

For each beat, provide:
1. A one-line summary
2. A 2-3 sentence expansion
3. Which characters are involved
4. Emotional stakes (what's at risk)
5. How it connects to existing threads

Return as a JSON array:
[{ "summary": "...", "expansion": "...", "characters": [...], "stakes": "...", "threads": [...], "surpriseFactor": "low|medium|high" }]`,

	brainstormExpand: `Take this selected story beat and expand it into a detailed beat sheet.

## Selected Beat
{{selectedBeat}}

## Story Context
{{storyState}}

## Constraints
{{constraints}}

Break the beat into 5-8 sub-beats with:
- Scene setting and atmosphere
- Character entrances and positioning
- Key dialogue moments
- Turning points
- Emotional arc within the beat

Return as a JSON array:
[{ "subBeat": "...", "type": "setup|rising|turning|climax|falling", "characters": [...], "notes": "..." }]`,

	// ============================================================
	// Dialogue Refinement Templates
	// ============================================================

	dialogueAnalyze: `Analyze the following text and extract all dialogue passages. For each character who speaks, identify their current voice patterns.

## Text to Analyze
{{text}}

## Known Character Profiles
{{characterProfiles}}

For each character, analyze:
1. Vocabulary level and favorite words/phrases
2. Sentence length patterns (terse vs verbose)
3. Use of contractions, slang, formal speech
4. Emotional undertones
5. Power dynamics in conversations

Return JSON:
{ "characters": [{ "name": "...", "voiceProfile": { "vocabulary": "...", "sentenceStyle": "...", "speechPatterns": "...", "emotionalTone": "...", "powerDynamic": "..." }, "sampleLines": [...] }] }`,

	dialogueRefine: `Refine the dialogue in the following passage. Each character should have a distinct, consistent voice that matches their established profile.

## Original Passage
{{passage}}

## Character Voice Profiles
{{voiceProfiles}}

## Reference Samples (from previous writing)
{{referenceSamples}}

## Refinement Instructions
{{instructions}}

Rules:
- Preserve the meaning and plot function of each line
- Maintain subtext and power dynamics
- Ensure each character sounds distinct from the others
- Add natural interruptions, overlaps, or pauses where appropriate
- Dialogue should reveal character, not just convey information

Return the refined passage with dialogue improved. Keep action lines mostly unchanged unless they directly support dialogue rhythm.`,

	dialogueEvaluate: `Evaluate the dialogue refinement quality.

## Original Passage
{{original}}

## Refined Passage
{{refined}}

## Character Voice Profiles
{{voiceProfiles}}

Assess:
1. Voice distinctiveness (can you tell characters apart by dialogue alone?)
2. Subtext quality (is there meaning beneath the surface?)
3. Naturalness (does it flow like real speech?)
4. Character consistency (does each character stay in voice?)
5. Plot function preserved (does the dialogue still advance the story?)

Return JSON:
{ "pass": true/false, "score": 0-100, "voiceDistinctiveness": { "pass": true/false, "notes": "..." }, "subtext": { "pass": true/false, "notes": "..." }, "naturalness": { "pass": true/false, "notes": "..." }, "consistency": { "pass": true/false, "notes": "..." }, "plotFunction": { "pass": true/false, "notes": "..." }, "suggestions": [...] }`,

	// ============================================================
	// Continuity Repair Templates
	// ============================================================

	continuityAudit: `Perform a thorough continuity audit of the following text against the established canon.

## Text to Audit
{{text}}

## Canon Facts (from Knowledge Graph)
{{canonFacts}}

## Timeline / Sequence
{{timeline}}

## World Rules
{{worldRules}}

Check for:
1. Character name/trait contradictions
2. Timeline inconsistencies (events out of order, impossible timing)
3. Location contradictions (character in two places)
4. Object/item state errors (destroyed items reappearing)
5. Rule violations (magic system rules, technology limits)
6. Relationship contradictions
7. Dialogue that contradicts established facts

For each issue, return JSON array:
[{ "line": "approximate location in text", "issue": "description", "category": "character|timeline|location|object|rule|relationship|dialogue", "severity": "critical|major|minor", "canonSource": "which canon fact it contradicts", "suggestedFix": "how to fix it" }]`,

	continuityRepair: `Fix the continuity issues in this text. Make minimal, surgical edits.

## Original Text
{{text}}

## Issues to Fix
{{issues}}

## Canon Facts (authoritative)
{{canonFacts}}

Rules:
- Fix ONLY the identified issues
- Preserve the author's voice and style
- Make the smallest possible changes
- If a fix requires adding new text, keep it brief
- Mark each fix with a comment like [FIXED: issue description]

Return the repaired text.`,

	continuityReport: `Generate a continuity report summarizing the audit results and repairs.

## Issues Found
{{issues}}

## Repairs Made
{{repairs}}

## Remaining Concerns
{{remaining}}

Create a structured report with:
1. Summary statistics (total issues, by category, by severity)
2. List of repairs made with before/after
3. List of unresolved issues that need human review
4. Recommendations for preventing similar issues

Return JSON:
{ "summary": { "total": N, "byCategory": {...}, "bySeverity": {...}, "repaired": N, "unresolved": N }, "repairs": [{ "issue": "...", "before": "...", "after": "..." }], "unresolved": [{ "issue": "...", "reason": "...", "recommendation": "..." }], "recommendations": [...] }`,

} as const;

export type TemplateName = keyof typeof TEMPLATES;
