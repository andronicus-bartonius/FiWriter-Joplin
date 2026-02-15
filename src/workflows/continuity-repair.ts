import {
	WorkflowGraph,
	WorkflowContext,
	WorkflowState,
	KGEntity,
} from '../core/types';
import { renderTemplate, TEMPLATES, SYSTEM_CONTINUITY_AUDITOR } from './prompt-templates';

// ============================================================
// Continuity Repair State
// ============================================================

export interface ContinuityRepairState extends WorkflowState {
	// Inputs
	text: string;
	scopeId: string;
	autoRepair: boolean;

	// Intermediate
	canonFacts: KGEntity[];
	worldRules: KGEntity[];
	timeline: string;
	issues: any[];

	// Outputs
	repairedText: string;
	report: any | null;
}

export function createContinuityRepairState(input: {
	text: string;
	scopeId?: string;
	autoRepair?: boolean;
}): ContinuityRepairState {
	return {
		text: input.text,
		scopeId: input.scopeId || '',
		autoRepair: input.autoRepair !== false,
		canonFacts: [],
		worldRules: [],
		timeline: '',
		issues: [],
		repairedText: '',
		report: null,
	};
}

// ============================================================
// Nodes
// ============================================================

async function gatherCanonNode(
	state: ContinuityRepairState,
	ctx: WorkflowContext,
): Promise<ContinuityRepairState> {
	const db = ctx.kg;
	if (!db) {
		return { ...state, timeline: 'No knowledge graph available for canon verification.' };
	}

	let canonFacts: KGEntity[] = [];
	let worldRules: KGEntity[] = [];
	let timeline = '';

	if (state.scopeId) {
		try {
			// Gather all entities in scope hierarchy for canon reference
			const characters = db.getEntitiesInScopeHierarchy(state.scopeId, 'Character') || [];
			const locations = db.getEntitiesInScopeHierarchy(state.scopeId, 'Location') || [];
			const events = db.getEntitiesInScopeHierarchy(state.scopeId, 'Event') || [];
			const items = db.getEntitiesInScopeHierarchy(state.scopeId, 'Item') || [];
			worldRules = db.getEntitiesInScopeHierarchy(state.scopeId, 'Rule') || [];

			canonFacts = [...characters, ...locations, ...events, ...items];

			// Build a rough timeline from events
			timeline = events
				.map((e: KGEntity) => `- ${e.name}: ${JSON.stringify(e.content)}`)
				.join('\n') || 'No timeline events found.';
		} catch (_e) { /* continue with empty */ }
	}

	return { ...state, canonFacts, worldRules, timeline };
}

async function auditNode(
	state: ContinuityRepairState,
	ctx: WorkflowContext,
): Promise<ContinuityRepairState> {
	const canonFactsSummary = state.canonFacts.length > 0
		? state.canonFacts.map((e: KGEntity) =>
			`[${e.type}] ${e.name}: ${JSON.stringify(e.content)}`
		).join('\n')
		: 'No canon facts available.';

	const worldRulesSummary = state.worldRules.length > 0
		? state.worldRules.map((r: KGEntity) =>
			`- ${r.name}: ${JSON.stringify(r.content)}`
		).join('\n')
		: 'No world rules specified.';

	const prompt = renderTemplate(TEMPLATES.continuityAudit, {
		text: state.text,
		canonFacts: canonFactsSummary,
		timeline: state.timeline,
		worldRules: worldRulesSummary,
	});

	const response = await ctx.llm.complete({
		messages: [
			{ role: 'system', content: SYSTEM_CONTINUITY_AUDITOR },
			{ role: 'user', content: prompt },
		],
		temperature: 0.2,
		signal: ctx.signal,
	});

	let issues: any[] = [];
	try {
		const jsonMatch = response.content.match(/\[[\s\S]*\]/);
		if (jsonMatch) {
			issues = JSON.parse(jsonMatch[0]);
		}
	} catch (_e) {
		issues = [{ issue: 'Failed to parse audit results', raw: response.content, severity: 'minor', category: 'parse-error' }];
	}

	return { ...state, issues };
}

async function repairNode(
	state: ContinuityRepairState,
	ctx: WorkflowContext,
): Promise<ContinuityRepairState> {
	if (state.issues.length === 0) {
		return { ...state, repairedText: state.text };
	}

	const canonFactsSummary = state.canonFacts.length > 0
		? state.canonFacts.map((e: KGEntity) =>
			`[${e.type}] ${e.name}: ${JSON.stringify(e.content)}`
		).join('\n')
		: 'No canon facts available.';

	const prompt = renderTemplate(TEMPLATES.continuityRepair, {
		text: state.text,
		issues: JSON.stringify(state.issues, null, 2),
		canonFacts: canonFactsSummary,
	});

	const response = await ctx.llm.complete({
		messages: [
			{ role: 'system', content: SYSTEM_CONTINUITY_AUDITOR },
			{ role: 'user', content: prompt },
		],
		temperature: 0.3,
		signal: ctx.signal,
	});

	return { ...state, repairedText: response.content };
}

async function reportNode(
	state: ContinuityRepairState,
	ctx: WorkflowContext,
): Promise<ContinuityRepairState> {
	const repairsMade = state.repairedText !== state.text
		? 'Text was modified to fix issues.'
		: 'No repairs were necessary.';

	// Identify remaining issues (issues that might not have been fully resolved)
	const remaining = state.issues.filter((i: any) => i.severity === 'critical');

	const prompt = renderTemplate(TEMPLATES.continuityReport, {
		issues: JSON.stringify(state.issues, null, 2),
		repairs: repairsMade,
		remaining: remaining.length > 0
			? JSON.stringify(remaining, null, 2)
			: 'None — all issues addressed.',
	});

	const response = await ctx.llm.complete({
		messages: [
			{ role: 'system', content: SYSTEM_CONTINUITY_AUDITOR },
			{ role: 'user', content: prompt },
		],
		temperature: 0.2,
		signal: ctx.signal,
	});

	let report: any = null;
	try {
		const jsonMatch = response.content.match(/\{[\s\S]*\}/);
		if (jsonMatch) {
			report = JSON.parse(jsonMatch[0]);
		}
	} catch (_e) {
		report = { raw: response.content };
	}

	return { ...state, report };
}

// ============================================================
// Graph
// ============================================================

export function buildContinuityRepairGraph(): WorkflowGraph<ContinuityRepairState> {
	return {
		id: 'continuity-repair',
		name: 'Continuity Repair',
		entryNode: 'gatherCanon',
		nodes: [
			{ id: 'gatherCanon', name: 'Gather Canon Facts', execute: gatherCanonNode },
			{ id: 'audit', name: 'Continuity Audit', execute: auditNode },
			{ id: 'repair', name: 'Repair Issues', execute: repairNode },
			{ id: 'report', name: 'Generate Report', execute: reportNode },
		],
		edges: [
			{ from: 'gatherCanon', to: 'audit' },
			{
				from: 'audit',
				to: 'repair',
				condition: (s: WorkflowState) => {
					const st = s as ContinuityRepairState;
					return st.autoRepair && st.issues.length > 0;
				},
			},
			{ from: 'audit', to: 'report' },
			{ from: 'repair', to: 'report' },
		],
	};
}
