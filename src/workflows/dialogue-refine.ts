import {
	WorkflowGraph,
	WorkflowContext,
	WorkflowState,
	KGEntity,
	RAGSearchResult,
} from '../core/types';
import { renderTemplate, TEMPLATES, SYSTEM_DIALOGUE_COACH } from './prompt-templates';

// ============================================================
// Dialogue Refinement State
// ============================================================

export interface DialogueRefineState extends WorkflowState {
	// Inputs
	text: string;
	instructions: string;
	scopeId: string;

	// Intermediate
	characterProfiles: KGEntity[];
	voiceAnalysis: any;
	ragSamples: RAGSearchResult[];

	// Outputs
	refinedText: string;
	evaluation: any | null;
}

export function createDialogueRefineState(input: {
	text: string;
	instructions?: string;
	scopeId?: string;
}): DialogueRefineState {
	return {
		text: input.text,
		instructions: input.instructions || '',
		scopeId: input.scopeId || '',
		characterProfiles: [],
		voiceAnalysis: null,
		ragSamples: [],
		refinedText: '',
		evaluation: null,
	};
}

// ============================================================
// Nodes
// ============================================================

async function gatherProfilesNode(
	state: DialogueRefineState,
	ctx: WorkflowContext,
): Promise<DialogueRefineState> {
	const db = ctx.kg;
	if (db && state.scopeId) {
		try {
			const characters = db.getEntitiesInScopeHierarchy(state.scopeId, 'Character') || [];
			return { ...state, characterProfiles: characters };
		} catch (_e) { /* continue */ }
	}
	return state;
}

async function ragSamplesNode(
	state: DialogueRefineState,
	ctx: WorkflowContext,
): Promise<DialogueRefineState> {
	if (!ctx.rag) return state;

	// Search for dialogue samples from existing writing
	const characterNames = state.characterProfiles.map((c: KGEntity) => c.name);
	const queries = characterNames.length > 0
		? characterNames.map((n: string) => `${n} dialogue`)
		: ['dialogue scene conversation'];

	const allResults: RAGSearchResult[] = [];
	for (const q of queries.slice(0, 5)) {
		try {
			const results = await ctx.rag.search(q, 3);
			allResults.push(...results);
		} catch (_e) { /* continue */ }
	}

	// Deduplicate by document ID
	const seen = new Set<string>();
	const unique = allResults.filter((r: RAGSearchResult) => {
		if (seen.has(r.documentId)) return false;
		seen.add(r.documentId);
		return true;
	});

	return { ...state, ragSamples: unique.slice(0, 8) };
}

async function analyzeVoiceNode(
	state: DialogueRefineState,
	ctx: WorkflowContext,
): Promise<DialogueRefineState> {
	const profilesSummary = state.characterProfiles.length > 0
		? state.characterProfiles.map((c: KGEntity) =>
			`${c.name}: ${JSON.stringify(c.content)}`
		).join('\n\n')
		: 'No character profiles available — analyze from the text itself.';

	const prompt = renderTemplate(TEMPLATES.dialogueAnalyze, {
		text: state.text,
		characterProfiles: profilesSummary,
	});

	const response = await ctx.llm.complete({
		messages: [
			{ role: 'system', content: SYSTEM_DIALOGUE_COACH },
			{ role: 'user', content: prompt },
		],
		temperature: 0.3,
		signal: ctx.signal,
	});

	let voiceAnalysis: any = null;
	try {
		const jsonMatch = response.content.match(/\{[\s\S]*\}/);
		if (jsonMatch) {
			voiceAnalysis = JSON.parse(jsonMatch[0]);
		}
	} catch (_e) {
		voiceAnalysis = { raw: response.content };
	}

	return { ...state, voiceAnalysis };
}

async function refineNode(
	state: DialogueRefineState,
	ctx: WorkflowContext,
): Promise<DialogueRefineState> {
	const voiceProfiles = state.voiceAnalysis
		? JSON.stringify(state.voiceAnalysis, null, 2)
		: 'No voice analysis available';

	const referenceSamples = state.ragSamples.length > 0
		? state.ragSamples.map((r: RAGSearchResult) =>
			`--- ${r.title || r.documentId} ---\n${r.snippet}`
		).join('\n\n')
		: 'No reference samples available';

	const prompt = renderTemplate(TEMPLATES.dialogueRefine, {
		passage: state.text,
		voiceProfiles,
		referenceSamples,
		instructions: state.instructions || 'Improve naturalness and character voice distinctiveness.',
	});

	const response = await ctx.llm.complete({
		messages: [
			{ role: 'system', content: SYSTEM_DIALOGUE_COACH },
			{ role: 'user', content: prompt },
		],
		temperature: 0.6,
		signal: ctx.signal,
	});

	return { ...state, refinedText: response.content };
}

async function evaluateNode(
	state: DialogueRefineState,
	ctx: WorkflowContext,
): Promise<DialogueRefineState> {
	const voiceProfiles = state.voiceAnalysis
		? JSON.stringify(state.voiceAnalysis, null, 2)
		: 'No voice profiles';

	const prompt = renderTemplate(TEMPLATES.dialogueEvaluate, {
		original: state.text,
		refined: state.refinedText,
		voiceProfiles,
	});

	const response = await ctx.llm.complete({
		messages: [
			{ role: 'system', content: SYSTEM_DIALOGUE_COACH },
			{ role: 'user', content: prompt },
		],
		temperature: 0.2,
		signal: ctx.signal,
	});

	let evaluation: any = null;
	try {
		const jsonMatch = response.content.match(/\{[\s\S]*\}/);
		if (jsonMatch) {
			evaluation = JSON.parse(jsonMatch[0]);
		}
	} catch (_e) {
		evaluation = { raw: response.content, pass: false, score: 0 };
	}

	return { ...state, evaluation };
}

// ============================================================
// Graph
// ============================================================

export function buildDialogueRefineGraph(): WorkflowGraph<DialogueRefineState> {
	return {
		id: 'dialogue-refine',
		name: 'Dialogue Refinement',
		entryNode: 'gatherProfiles',
		nodes: [
			{ id: 'gatherProfiles', name: 'Gather Character Profiles', execute: gatherProfilesNode },
			{ id: 'ragSamples', name: 'Fetch Reference Samples', execute: ragSamplesNode },
			{ id: 'analyzeVoice', name: 'Analyze Voice Patterns', execute: analyzeVoiceNode },
			{ id: 'refine', name: 'Refine Dialogue', execute: refineNode },
			{ id: 'evaluate', name: 'Evaluate Refinement', execute: evaluateNode },
		],
		edges: [
			{ from: 'gatherProfiles', to: 'ragSamples' },
			{ from: 'ragSamples', to: 'analyzeVoice' },
			{ from: 'analyzeVoice', to: 'refine' },
			{ from: 'refine', to: 'evaluate' },
		],
	};
}
