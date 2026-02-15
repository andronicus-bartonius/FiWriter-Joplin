import {
	WorkflowGraph,
	WorkflowContext,
	WorkflowState,
	KGEntity,
	RAGSearchResult,
} from '../core/types';
import { renderTemplate, TEMPLATES, SYSTEM_SCREENWRITER, SYSTEM_CONTINUITY_CHECKER, SYSTEM_EVALUATOR } from './prompt-templates';

// ============================================================
// Scene Draft State
// ============================================================

export interface SceneDraftState extends WorkflowState {
	// Inputs
	outline: string;
	userInstructions: string;
	pinnedEntityIds: string[];
	scopeId: string;

	// Intermediate — populated by workflow nodes
	identifiedEntities: { characters: string[]; locations: string[]; arcs: string[]; rules: string[]; items: string[] };
	entityDetails: KGEntity[];
	worldRules: KGEntity[];
	characterStates: Record<string, any>[];
	constraints: string;
	ragSnippets: RAGSearchResult[];
	draft: string;
	contradictions: any[];
	proposedDeltas: any[];
	evaluation: any;
	revisionCount: number;

	// Output
	finalDraft: string;
	citations: string[];
	kgUpdates: any[];
}

function defaultState(partial: Partial<SceneDraftState>): SceneDraftState {
	return {
		outline: '',
		userInstructions: '',
		pinnedEntityIds: [],
		scopeId: '',
		identifiedEntities: { characters: [], locations: [], arcs: [], rules: [], items: [] },
		entityDetails: [],
		worldRules: [],
		characterStates: [],
		constraints: '',
		ragSnippets: [],
		draft: '',
		contradictions: [],
		proposedDeltas: [],
		evaluation: null,
		revisionCount: 0,
		finalDraft: '',
		citations: [],
		kgUpdates: [],
		...partial,
	};
}

// ============================================================
// Node 1: Identify Scope & Entities
// ============================================================

async function identifyNode(state: SceneDraftState, ctx: WorkflowContext): Promise<SceneDraftState> {
	const pinnedSummary = state.pinnedEntityIds.length > 0
		? `Pinned entity IDs: ${state.pinnedEntityIds.join(', ')}`
		: 'None pinned';

	const prompt = renderTemplate(TEMPLATES.identifyContext, {
		outline: state.outline,
		pinnedEntities: pinnedSummary,
	});

	const response = await ctx.llm.complete({
		messages: [
			{ role: 'system', content: SYSTEM_SCREENWRITER },
			{ role: 'user', content: prompt },
		],
		temperature: 0.3,
		signal: ctx.signal,
	});

	let identified = state.identifiedEntities;
	try {
		const jsonMatch = response.content.match(/\{[\s\S]*\}/);
		if (jsonMatch) {
			identified = JSON.parse(jsonMatch[0]);
		}
	} catch {
		// Keep defaults if parsing fails
	}

	return { ...state, identifiedEntities: identified };
}

// ============================================================
// Node 2: Query KG for Constraints
// ============================================================

async function constraintsNode(state: SceneDraftState, ctx: WorkflowContext): Promise<SceneDraftState> {
	if (!ctx.kg) {
		return { ...state, constraints: 'No knowledge graph available.' };
	}

	const db = ctx.kg;

	// Fetch entities from KG matching identified names
	const allNames = [
		...state.identifiedEntities.characters,
		...state.identifiedEntities.locations,
		...state.identifiedEntities.arcs,
		...state.identifiedEntities.items,
	];

	const entityDetails: KGEntity[] = [];
	for (const name of allNames) {
		const results = db.searchEntities(name, 3);
		entityDetails.push(...results);
	}

	// Also fetch pinned entities directly
	for (const id of state.pinnedEntityIds) {
		const entity = db.getEntity(id);
		if (entity && !entityDetails.find((e: KGEntity) => e.id === entity.id)) {
			entityDetails.push(entity);
		}
	}

	// Fetch world rules in scope
	const worldRules = state.scopeId
		? db.getEntitiesInScopeHierarchy(state.scopeId, 'Rule')
		: [];

	// Build character states from state snapshots
	const characterStates: Record<string, any>[] = [];
	const characters = entityDetails.filter((e: KGEntity) => e.type === 'Character');
	for (const char of characters) {
		const snapshots = db.getStateSnapshots(char.id);
		if (snapshots.length > 0) {
			const latest = snapshots[snapshots.length - 1];
			characterStates.push({ name: char.name, id: char.id, state: latest.stateData });
		}
	}

	// Generate constraint summary via LLM
	const prompt = renderTemplate(TEMPLATES.gatherConstraints, {
		entityDetails: JSON.stringify(entityDetails.map((e: KGEntity) => ({ name: e.name, type: e.type, content: e.content })), null, 2),
		worldRules: JSON.stringify(worldRules.map((r: KGEntity) => ({ name: r.name, content: r.content })), null, 2),
		characterStates: JSON.stringify(characterStates, null, 2),
	});

	const response = await ctx.llm.complete({
		messages: [
			{ role: 'system', content: SYSTEM_CONTINUITY_CHECKER },
			{ role: 'user', content: prompt },
		],
		temperature: 0.2,
		signal: ctx.signal,
	});

	return {
		...state,
		entityDetails,
		worldRules,
		characterStates,
		constraints: response.content,
	};
}

// ============================================================
// Node 3: Retrieve RAG Snippets
// ============================================================

async function ragNode(state: SceneDraftState, ctx: WorkflowContext): Promise<SceneDraftState> {
	if (!ctx.rag) {
		return { ...state, ragSnippets: [] };
	}

	// Build a query from the outline + character names for voice matching
	const queryParts = [state.outline.substring(0, 200)];
	for (const name of state.identifiedEntities.characters.slice(0, 3)) {
		queryParts.push(name);
	}

	const results = await ctx.rag.search(queryParts.join(' '), 5);
	return { ...state, ragSnippets: results };
}

// ============================================================
// Node 4: Generate Draft
// ============================================================

async function generateNode(state: SceneDraftState, ctx: WorkflowContext): Promise<SceneDraftState> {
	const ragText = state.ragSnippets.length > 0
		? state.ragSnippets.map((r: RAGSearchResult) => `[${r.title}]: ${r.snippet}`).join('\n\n')
		: 'No reference snippets available.';

	const entityContext = state.entityDetails.length > 0
		? state.entityDetails.map((e: KGEntity) => `${e.type} "${e.name}": ${JSON.stringify(e.content)}`).join('\n')
		: 'No entity context available.';

	const prompt = renderTemplate(TEMPLATES.generateDraft, {
		outline: state.outline,
		constraints: state.constraints,
		ragSnippets: ragText,
		entityContext: entityContext,
		userInstructions: state.userInstructions || 'None.',
	});

	const response = await ctx.llm.complete({
		messages: [
			{ role: 'system', content: SYSTEM_SCREENWRITER },
			{ role: 'user', content: prompt },
		],
		temperature: 0.7,
		maxTokens: 4000,
		signal: ctx.signal,
	});

	return { ...state, draft: response.content };
}

// ============================================================
// Node 5: Continuity Check
// ============================================================

async function continuityNode(state: SceneDraftState, ctx: WorkflowContext): Promise<SceneDraftState> {
	if (!state.constraints || state.constraints === 'No knowledge graph available.') {
		return { ...state, contradictions: [] };
	}

	const prompt = renderTemplate(TEMPLATES.continuityCheck, {
		draft: state.draft,
		constraints: state.constraints,
		entityDetails: JSON.stringify(state.entityDetails.map((e: KGEntity) => ({ name: e.name, type: e.type, content: e.content })), null, 2),
	});

	const response = await ctx.llm.complete({
		messages: [
			{ role: 'system', content: SYSTEM_CONTINUITY_CHECKER },
			{ role: 'user', content: prompt },
		],
		temperature: 0.1,
		signal: ctx.signal,
	});

	let contradictions: any[] = [];
	try {
		const jsonMatch = response.content.match(/\[[\s\S]*\]/);
		if (jsonMatch) {
			contradictions = JSON.parse(jsonMatch[0]);
		}
	} catch {
		// No contradictions parseable
	}

	return { ...state, contradictions };
}

// ============================================================
// Node 6: Propose KG Deltas
// ============================================================

async function deltasNode(state: SceneDraftState, ctx: WorkflowContext): Promise<SceneDraftState> {
	const prompt = renderTemplate(TEMPLATES.proposeDeltas, {
		draft: state.draft,
		entityDetails: JSON.stringify(state.entityDetails.map((e: KGEntity) => ({ name: e.name, type: e.type, content: e.content })), null, 2),
	});

	const response = await ctx.llm.complete({
		messages: [
			{ role: 'system', content: SYSTEM_CONTINUITY_CHECKER },
			{ role: 'user', content: prompt },
		],
		temperature: 0.2,
		signal: ctx.signal,
	});

	let proposedDeltas: any[] = [];
	try {
		const jsonMatch = response.content.match(/\[[\s\S]*\]/);
		if (jsonMatch) {
			proposedDeltas = JSON.parse(jsonMatch[0]);
		}
	} catch {
		// No deltas parseable
	}

	return { ...state, proposedDeltas };
}

// ============================================================
// Node 7: Revise Draft (conditional — only if contradictions found)
// ============================================================

async function reviseNode(state: SceneDraftState, ctx: WorkflowContext): Promise<SceneDraftState> {
	const prompt = renderTemplate(TEMPLATES.reviseDraft, {
		draft: state.draft,
		contradictions: JSON.stringify(state.contradictions, null, 2),
		constraints: state.constraints,
	});

	const response = await ctx.llm.complete({
		messages: [
			{ role: 'system', content: SYSTEM_SCREENWRITER },
			{ role: 'user', content: prompt },
		],
		temperature: 0.5,
		maxTokens: 4000,
		signal: ctx.signal,
	});

	return {
		...state,
		draft: response.content,
		revisionCount: state.revisionCount + 1,
		contradictions: [], // Clear after revision
	};
}

// ============================================================
// Node 8: Evaluate Output
// ============================================================

async function evaluateNode(state: SceneDraftState, ctx: WorkflowContext): Promise<SceneDraftState> {
	const prompt = renderTemplate(TEMPLATES.evaluateOutput, {
		draft: state.draft,
		outline: state.outline,
	});

	const response = await ctx.llm.complete({
		messages: [
			{ role: 'system', content: SYSTEM_EVALUATOR },
			{ role: 'user', content: prompt },
		],
		temperature: 0.2,
		signal: ctx.signal,
	});

	let evaluation: any = { pass: true, score: 70 };
	try {
		const jsonMatch = response.content.match(/\{[\s\S]*\}/);
		if (jsonMatch) {
			evaluation = JSON.parse(jsonMatch[0]);
		}
	} catch {
		// Keep default
	}

	return { ...state, evaluation };
}

// ============================================================
// Node 9: Finalize Output
// ============================================================

async function finalizeNode(state: SceneDraftState, _ctx: WorkflowContext): Promise<SceneDraftState> {
	// Build citation list from RAG snippets used
	const citations = state.ragSnippets.map((r: RAGSearchResult) => `[${r.title}] (note: ${r.noteId})`);

	return {
		...state,
		finalDraft: state.draft,
		citations,
		kgUpdates: state.proposedDeltas,
	};
}

// ============================================================
// Build the Outline → Scene Draft WorkflowGraph
// ============================================================

export function buildSceneDraftGraph(): WorkflowGraph<SceneDraftState> {
	return {
		id: 'outline-to-scene-draft',
		name: 'Outline → Scene Draft',
		entryNode: 'identify',
		maxIterations: 20,
		nodes: [
			{ id: 'identify', name: 'Identify Scope & Entities', execute: identifyNode },
			{ id: 'constraints', name: 'Query KG Constraints', execute: constraintsNode },
			{ id: 'rag', name: 'Retrieve RAG Snippets', execute: ragNode },
			{ id: 'generate', name: 'Generate Draft', execute: generateNode },
			{ id: 'continuity', name: 'Continuity Check', execute: continuityNode },
			{ id: 'deltas', name: 'Propose KG Deltas', execute: deltasNode },
			{ id: 'revise', name: 'Revise Draft', execute: reviseNode },
			{ id: 'evaluate', name: 'Evaluate Output', execute: evaluateNode },
			{ id: 'finalize', name: 'Finalize Output', execute: finalizeNode },
		],
		edges: [
			// Linear flow: identify → constraints → rag → generate → continuity
			{ from: 'identify', to: 'constraints' },
			{ from: 'constraints', to: 'rag' },
			{ from: 'rag', to: 'generate' },
			{ from: 'generate', to: 'continuity' },

			// After continuity check: branch on contradictions
			// If contradictions found and haven't revised too many times → revise
			{
				from: 'continuity',
				to: 'revise',
				condition: (s: WorkflowState) => {
					const st = s as SceneDraftState;
					return st.contradictions.length > 0 && st.revisionCount < 2;
				},
			},
			// If no contradictions (or max revisions reached) → deltas
			{ from: 'continuity', to: 'deltas' },

			// After revision, re-check continuity
			{ from: 'revise', to: 'continuity' },

			// After deltas → evaluate
			{ from: 'deltas', to: 'evaluate' },

			// After evaluate → finalize (terminal)
			{ from: 'evaluate', to: 'finalize' },
		],
	};
}

export { defaultState as createSceneDraftState };
