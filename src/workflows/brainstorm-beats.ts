import {
	WorkflowGraph,
	WorkflowContext,
	WorkflowState,
	KGEntity,
	RAGSearchResult,
} from '../core/types';
import { renderTemplate, TEMPLATES, SYSTEM_BRAINSTORMER } from './prompt-templates';

// ============================================================
// Brainstorm Beats State
// ============================================================

export interface BrainstormBeatsState extends WorkflowState {
	// Inputs
	premise: string;
	userDirection: string;
	tone: string;
	beatCount: number;
	scopeId: string;
	selectedBeatIndex: number | null; // set if user picks a beat to expand

	// Intermediate
	characters: KGEntity[];
	arcs: KGEntity[];
	worldRules: KGEntity[];
	constraints: string;
	storyState: string;
	ragSnippets: RAGSearchResult[];

	// Outputs
	beats: any[];
	expandedBeat: any | null;
}

export function createBrainstormState(input: {
	premise: string;
	userDirection?: string;
	tone?: string;
	beatCount?: number;
	scopeId?: string;
}): BrainstormBeatsState {
	return {
		premise: input.premise,
		userDirection: input.userDirection || '',
		tone: input.tone || '',
		beatCount: input.beatCount || 5,
		scopeId: input.scopeId || '',
		selectedBeatIndex: null,
		characters: [],
		arcs: [],
		worldRules: [],
		constraints: '',
		storyState: '',
		ragSnippets: [],
		beats: [],
		expandedBeat: null,
	};
}

// ============================================================
// Nodes
// ============================================================

async function gatherContextNode(
	state: BrainstormBeatsState,
	ctx: WorkflowContext,
): Promise<BrainstormBeatsState> {
	const db = ctx.kg;
	if (db && state.scopeId) {
		try {
			const characters = db.getEntitiesInScopeHierarchy(state.scopeId, 'Character') || [];
			const arcs = db.getEntitiesInScopeHierarchy(state.scopeId, 'Arc') || [];
			const worldRules = db.getEntitiesInScopeHierarchy(state.scopeId, 'Rule') || [];
			return { ...state, characters, arcs, worldRules };
		} catch (_e) {
			// KG not available, continue without
		}
	}
	return state;
}

async function ragContextNode(
	state: BrainstormBeatsState,
	ctx: WorkflowContext,
): Promise<BrainstormBeatsState> {
	if (ctx.rag && state.premise) {
		try {
			const results = await ctx.rag.search(state.premise, 5);
			return { ...state, ragSnippets: results };
		} catch (_e) { /* continue without RAG */ }
	}
	return state;
}

async function analyzeStateNode(
	state: BrainstormBeatsState,
	ctx: WorkflowContext,
): Promise<BrainstormBeatsState> {
	const constraintsList = state.worldRules
		.map((r: KGEntity) => `- ${r.name}: ${JSON.stringify(r.content)}`)
		.join('\n') || 'None specified';

	const prompt = renderTemplate(TEMPLATES.brainstormAnalyze, {
		premise: state.premise,
		characters: state.characters.map((c: KGEntity) => `${c.name} (${c.type})`).join(', ') || 'None specified',
		arcs: state.arcs.map((a: KGEntity) => `${a.name}: ${JSON.stringify(a.content)}`).join('\n') || 'None specified',
		worldRules: constraintsList,
	});

	const response = await ctx.llm.complete({
		messages: [
			{ role: 'system', content: SYSTEM_BRAINSTORMER },
			{ role: 'user', content: prompt },
		],
		temperature: 0.5,
		signal: ctx.signal,
	});

	return {
		...state,
		storyState: response.content,
		constraints: constraintsList,
	};
}

async function generateBeatsNode(
	state: BrainstormBeatsState,
	ctx: WorkflowContext,
): Promise<BrainstormBeatsState> {
	const prompt = renderTemplate(TEMPLATES.brainstormGenerate, {
		count: String(state.beatCount),
		storyState: state.storyState,
		tone: state.tone || 'Not specified — infer from context',
		userDirection: state.userDirection || 'No specific direction — surprise me',
		constraints: state.constraints,
	});

	const response = await ctx.llm.complete({
		messages: [
			{ role: 'system', content: SYSTEM_BRAINSTORMER },
			{ role: 'user', content: prompt },
		],
		temperature: 0.8,
		signal: ctx.signal,
	});

	let beats: any[] = [];
	try {
		const jsonMatch = response.content.match(/\[[\s\S]*\]/);
		if (jsonMatch) {
			beats = JSON.parse(jsonMatch[0]);
		}
	} catch (_e) {
		beats = [{ summary: 'Failed to parse beats', expansion: response.content, characters: [], stakes: '', threads: [], surpriseFactor: 'medium' }];
	}

	return { ...state, beats };
}

async function expandBeatNode(
	state: BrainstormBeatsState,
	ctx: WorkflowContext,
): Promise<BrainstormBeatsState> {
	if (state.selectedBeatIndex === null || !state.beats[state.selectedBeatIndex]) {
		return state;
	}

	const selectedBeat = state.beats[state.selectedBeatIndex];
	const prompt = renderTemplate(TEMPLATES.brainstormExpand, {
		selectedBeat: JSON.stringify(selectedBeat, null, 2),
		storyState: state.storyState,
		constraints: state.constraints,
	});

	const response = await ctx.llm.complete({
		messages: [
			{ role: 'system', content: SYSTEM_BRAINSTORMER },
			{ role: 'user', content: prompt },
		],
		temperature: 0.7,
		signal: ctx.signal,
	});

	let expandedBeat: any = null;
	try {
		const jsonMatch = response.content.match(/\[[\s\S]*\]/);
		if (jsonMatch) {
			expandedBeat = { beat: selectedBeat, subBeats: JSON.parse(jsonMatch[0]) };
		}
	} catch (_e) {
		expandedBeat = { beat: selectedBeat, subBeats: [], raw: response.content };
	}

	return { ...state, expandedBeat };
}

// ============================================================
// Graph
// ============================================================

export function buildBrainstormGraph(): WorkflowGraph<BrainstormBeatsState> {
	return {
		id: 'brainstorm-beats',
		name: 'Brainstorm Beats',
		nodes: [
			{ id: 'gatherContext', name: 'Gather Context', execute: gatherContextNode },
			{ id: 'ragContext', name: 'RAG Context', execute: ragContextNode },
			{ id: 'analyzeState', name: 'Analyze Story State', execute: analyzeStateNode },
			{ id: 'generateBeats', name: 'Generate Beats', execute: generateBeatsNode },
			{ id: 'expandBeat', name: 'Expand Beat', execute: expandBeatNode },
		],
		edges: [
			{ from: 'gatherContext', to: 'ragContext' },
			{ from: 'ragContext', to: 'analyzeState' },
			{ from: 'analyzeState', to: 'generateBeats' },
			{
				from: 'generateBeats',
				to: 'expandBeat',
				condition: (state) => state.selectedBeatIndex !== null,
			},
		],
		entryNode: 'gatherContext',
	};
}
