import joplin from 'api';
import { PluginMessage, WorkflowContext } from './types';
import { getSettingValues } from './settings';
import { KGManager } from '../kg/kg-manager';
import { OpenAICompatProvider } from '../providers/llm-provider';
import { RetrievalAPI } from '../rag/retrieval';
import { DAGRunner } from '../workflows/dag-runner';
import { buildSceneDraftGraph, createSceneDraftState, SceneDraftState } from '../workflows/scene-draft';
import { buildBrainstormGraph, createBrainstormState, BrainstormBeatsState } from '../workflows/brainstorm-beats';
import { buildDialogueRefineGraph, createDialogueRefineState, DialogueRefineState } from '../workflows/dialogue-refine';
import { buildContinuityRepairGraph, createContinuityRepairState, ContinuityRepairState } from '../workflows/continuity-repair';
import {
	getProjects,
	getActiveProject,
	setActiveProject,
	createProject,
	updateProject,
	deleteProject,
} from './project-registry';

/**
 * Central message handler for plugin <-> webview communication.
 * Routes messages from the sidebar panel (and future dialogs) to
 * the appropriate backend services.
 */
export class MessageHandler {
	private llmProvider: OpenAICompatProvider;
	private kgManager: KGManager;
	private retrievalAPI: RetrievalAPI | null = null;
	private panelHandle: string | null = null;
	private openStoryboardFn: (() => Promise<void>) | null = null;
	private openOutputReviewFn: (() => Promise<void>) | null = null;
	private activeWorkflowAbort: AbortController | null = null;
	private activeRunner: DAGRunner<any> | null = null;
	private lastWorkflowResult: any = null;

	constructor(llmProvider: OpenAICompatProvider, kgManager: KGManager) {
		this.llmProvider = llmProvider;
		this.kgManager = kgManager;
	}

	setRetrievalAPI(api: RetrievalAPI): void {
		this.retrievalAPI = api;
	}

	setPanelHandle(handle: string): void {
		this.panelHandle = handle;
	}

	setOpenStoryboardFn(fn: () => Promise<void>): void {
		this.openStoryboardFn = fn;
	}

	setOpenOutputReviewFn(fn: () => Promise<void>): void {
		this.openOutputReviewFn = fn;
	}

	/**
	 * Handle an incoming message from a webview.
	 * Returns a response payload (or undefined for fire-and-forget messages).
	 */
	async handleMessage(message: PluginMessage): Promise<any> {
		try {
			switch (message.type) {
				case 'getState':
					return this.handleGetState();

				case 'testConnection':
					return this.handleTestConnection();

				case 'getProjects':
					return getProjects();

				case 'setActiveProject':
					return this.handleSetActiveProject(message.payload);

				case 'createProject':
					return this.handleCreateProject(message.payload);

				case 'updateProject':
					return this.handleUpdateProject(message.payload);

				case 'deleteProject':
					return this.handleDeleteProject(message.payload);

				case 'openStoryboard':
					return this.handleOpenStoryboard();

				case 'openOutputReview':
					return this.handleOpenOutputReview(message.payload);

				case 'insertToNote':
					return this.handleInsertToNote(message.payload);

				case 'ragSearch':
					return this.handleRAGSearch(message.payload);

				case 'kgQuery':
					return this.handleKGQuery(message.payload);

				case 'kgMutate':
					return this.handleKGMutate(message.payload);

				case 'runWorkflow':
					return this.handleRunWorkflow(message.payload);

				case 'cancelWorkflow':
					return this.handleCancelWorkflow();

				default:
					console.warn(`[FiRiter] Unknown message type: ${message.type}`);
					return { error: `Unknown message type: ${message.type}` };
			}
		} catch (err: any) {
			console.error(`[FiRiter] Error handling message ${message.type}:`, err);
			return { error: err.message || String(err) };
		}
	}

	// ================================================================
	// State
	// ================================================================

	private async handleGetState(): Promise<any> {
		const settings = await getSettingValues();
		const activeProject = await getActiveProject();
		const registry = await getProjects();

		let connected = false;
		if (settings.llmBaseUrl && settings.llmModel) {
			try {
				this.llmProvider.configure({
					baseUrl: settings.llmBaseUrl,
					apiKey: settings.llmApiKey || undefined,
					model: settings.llmModel,
					embeddingEndpoint: settings.embeddingEndpoint || undefined,
					embeddingModel: settings.embeddingModel || undefined,
				});
				const result = await this.llmProvider.testConnection();
				connected = result.ok;
			} catch {
				connected = false;
			}
		}

		return {
			connected,
			activeProject,
			projects: registry.projects,
			pinnedCards: [],
			workflowStatus: 'idle',
			workflowName: '',
		};
	}

	// ================================================================
	// LLM Connection
	// ================================================================

	private async handleTestConnection(): Promise<any> {
		const settings = await getSettingValues();
		if (!settings.llmBaseUrl) {
			return { ok: false, error: 'No LLM Base URL configured. Set it in FiRiter settings.' };
		}
		if (!settings.llmModel) {
			return { ok: false, error: 'No LLM Model configured. Set it in FiRiter settings.' };
		}

		this.llmProvider.configure({
			baseUrl: settings.llmBaseUrl,
			apiKey: settings.llmApiKey || undefined,
			model: settings.llmModel,
			embeddingEndpoint: settings.embeddingEndpoint || undefined,
			embeddingModel: settings.embeddingModel || undefined,
		});

		const result = await this.llmProvider.testConnection();

		// Push updated state to sidebar
		if (this.panelHandle) {
			await this.pushSidebarUpdate({ connected: result.ok });
		}

		return result;
	}

	// ================================================================
	// Project management
	// ================================================================

	private async handleSetActiveProject(payload: any): Promise<any> {
		await setActiveProject(payload.projectId);
		const project = await getActiveProject();

		// Load KG for the new active project
		if (project) {
			await this.kgManager.loadForProject(project);
		}

		await this.pushSidebarUpdate({ activeProject: project });
		return { success: true, activeProject: project };
	}

	private async handleCreateProject(payload: any): Promise<any> {
		const project = await createProject(
			payload.name,
			payload.notebookIds || [],
			payload.tagIds || [],
		);

		// Load KG for the new project (and auto-save to create the resource)
		await this.kgManager.loadForProject(project);
		await this.kgManager.save();

		const registry = await getProjects();
		await this.pushSidebarUpdate({
			activeProject: project,
			projects: registry.projects,
		});

		return { success: true, project };
	}

	private async handleUpdateProject(payload: any): Promise<any> {
		const project = await updateProject(payload.projectId, payload.updates);
		const registry = await getProjects();
		const active = await getActiveProject();
		await this.pushSidebarUpdate({
			activeProject: active,
			projects: registry.projects,
		});
		return { success: true, project };
	}

	private async handleDeleteProject(payload: any): Promise<any> {
		await deleteProject(payload.projectId);
		const registry = await getProjects();
		const active = await getActiveProject();

		if (active) {
			await this.kgManager.loadForProject(active);
		} else {
			await this.kgManager.close();
		}

		await this.pushSidebarUpdate({
			activeProject: active,
			projects: registry.projects,
		});
		return { success: true };
	}

	// ================================================================
	// Workflow Execution
	// ================================================================

	private async handleRunWorkflow(payload: any): Promise<any> {
		if (this.activeRunner) {
			const status = this.activeRunner.getStatus();
			if (status === 'running' || status === 'paused') {
				return { error: 'A workflow is already running. Cancel it first.' };
			}
		}

		const { workflowId } = payload || {};

		// Build graph + initial state based on workflow type
		let runner: DAGRunner<any>;
		let initialState: any;

		switch (workflowId) {
			case 'outline-to-scene-draft': {
				const { outline, userInstructions, pinnedEntityIds, scopeId } = payload;
				if (!outline || typeof outline !== 'string') {
					return { error: 'An outline is required to run this workflow.' };
				}
				runner = new DAGRunner<SceneDraftState>(buildSceneDraftGraph());
				initialState = createSceneDraftState({
					outline,
					userInstructions: userInstructions || '',
					pinnedEntityIds: pinnedEntityIds || [],
					scopeId: scopeId || '',
				});
				break;
			}
			case 'brainstorm-beats': {
				const { premise, userDirection, tone, beatCount, scopeId } = payload;
				if (!premise || typeof premise !== 'string') {
					return { error: 'A premise / story context is required.' };
				}
				runner = new DAGRunner<BrainstormBeatsState>(buildBrainstormGraph());
				initialState = createBrainstormState({
					premise,
					userDirection: userDirection || '',
					tone: tone || '',
					beatCount: beatCount || 5,
					scopeId: scopeId || '',
				});
				break;
			}
			case 'dialogue-refine': {
				const { text, instructions, scopeId } = payload;
				if (!text || typeof text !== 'string') {
					return { error: 'Text containing dialogue is required.' };
				}
				runner = new DAGRunner<DialogueRefineState>(buildDialogueRefineGraph());
				initialState = createDialogueRefineState({
					text,
					instructions: instructions || '',
					scopeId: scopeId || '',
				});
				break;
			}
			case 'continuity-repair': {
				const { text, scopeId, autoRepair } = payload;
				if (!text || typeof text !== 'string') {
					return { error: 'Text to audit is required.' };
				}
				runner = new DAGRunner<ContinuityRepairState>(buildContinuityRepairGraph());
				initialState = createContinuityRepairState({
					text,
					scopeId: scopeId || '',
					autoRepair: autoRepair !== false,
				});
				break;
			}
			default:
				return { error: `Unknown workflow: ${workflowId}` };
		}

		this.activeRunner = runner;
		const abortController = new AbortController();
		this.activeWorkflowAbort = abortController;

		const db = this.kgManager.getDatabase();
		const context: WorkflowContext = {
			llm: this.llmProvider,
			kg: db || undefined,
			rag: this.retrievalAPI || undefined,
			signal: abortController.signal,
			onProgress: (nodeId, _state) => {
				this.pushSidebarUpdate({
					type: 'workflowProgress',
					workflowId,
					nodeId,
					workflowStatus: runner.getStatus(),
				});
			},
		};

		// Run asynchronously so we can return immediately
		const resultPromise = runner.run(initialState, context);

		resultPromise.then((result) => {
			this.activeRunner = null;
			this.activeWorkflowAbort = null;
			this.lastWorkflowResult = this.extractWorkflowResult(workflowId, result);
			this.pushSidebarUpdate({ type: 'workflowComplete', ...this.lastWorkflowResult });
			// Auto-open output review dialog for workflows that produce text output
			const hasOutput = this.lastWorkflowResult.finalDraft
				|| this.lastWorkflowResult.refinedText
				|| this.lastWorkflowResult.repairedText;
			if (this.openOutputReviewFn && hasOutput) {
				this.openOutputReviewFn().catch((e: any) => {
					console.error('[FiRiter] Failed to open output review:', e);
				});
			}
		}).catch((err: any) => {
			this.activeRunner = null;
			this.activeWorkflowAbort = null;
			this.lastWorkflowResult = { workflowId, status: 'error', error: err.message || String(err) };
			this.pushSidebarUpdate({ type: 'workflowError', error: err.message || String(err) });
		});

		return { success: true, message: `Workflow '${workflowId}' started` };
	}

	private extractWorkflowResult(workflowId: string, result: any): any {
		const base = {
			workflowId,
			status: result.status,
			error: result.error,
			nodesVisited: result.nodesVisited,
		};
		const s = result.finalState;

		switch (workflowId) {
			case 'outline-to-scene-draft':
				return { ...base, finalDraft: s.finalDraft, citations: s.citations, kgUpdates: s.kgUpdates, evaluation: s.evaluation };
			case 'brainstorm-beats':
				return { ...base, beats: s.beats, expandedBeat: s.expandedBeat, storyState: s.storyState };
			case 'dialogue-refine':
				return { ...base, refinedText: s.refinedText, evaluation: s.evaluation, voiceAnalysis: s.voiceAnalysis };
			case 'continuity-repair':
				return { ...base, repairedText: s.repairedText, issues: s.issues, report: s.report };
			default:
				return { ...base, finalState: s };
		}
	}

	private async handleCancelWorkflow(): Promise<any> {
		if (this.activeWorkflowAbort) {
			this.activeWorkflowAbort.abort();
			this.activeWorkflowAbort = null;
			this.activeRunner = null;
			return { success: true, message: 'Workflow cancelled' };
		}
		return { error: 'No active workflow to cancel' };
	}

	// ================================================================
	// Output Review
	// ================================================================

	private async handleOpenOutputReview(payload: any): Promise<any> {
		if (payload?.action === 'regenerate') {
			// TODO: re-run the workflow with the same inputs
			return { info: 'Regeneration not yet implemented' };
		}

		// Return the stored workflow result for the dialog to display
		if (this.lastWorkflowResult) {
			return { workflowResult: this.lastWorkflowResult };
		}

		if (this.openOutputReviewFn) {
			await this.openOutputReviewFn();
			return { success: true };
		}
		return { error: 'No workflow result available' };
	}

	// ================================================================
	// RAG Search
	// ================================================================

	private async handleRAGSearch(payload: any): Promise<any> {
		if (!this.retrievalAPI) {
			return { error: 'RAG not initialized. Build the index first.' };
		}
		const { query, maxResults } = payload;
		if (!query || typeof query !== 'string') {
			return { error: 'A query string is required.' };
		}
		const results = await this.retrievalAPI.search(query, maxResults || 10);
		return { results, stats: this.retrievalAPI.stats };
	}

	// ================================================================
	// Storyboard
	// ================================================================

	private async handleOpenStoryboard(): Promise<any> {
		const activeProject = await getActiveProject();
		if (!activeProject) {
			return { error: 'No active project. Create a project first.' };
		}
		if (this.openStoryboardFn) {
			await this.openStoryboardFn();
			return { success: true };
		}
		return { error: 'Storyboard dialog not initialized' };
	}

	// ================================================================
	// Note insertion
	// ================================================================

	private async handleInsertToNote(payload: any): Promise<any> {
		const { content, mode } = payload; // mode: 'insert' | 'append' | 'new'

		if (mode === 'new') {
			const activeProject = await getActiveProject();
			const parentId = activeProject?.notebookIds?.[0] || undefined;
			const note = await joplin.data.post(['notes'], null, {
				title: payload.title || 'FiRiter Output',
				body: content,
				parent_id: parentId,
			});
			return { success: true, noteId: note.id };
		}

		// For insert/append, we need the current note
		const selectedNote = await joplin.workspace.selectedNote();
		if (!selectedNote) {
			return { error: 'No note is currently selected.' };
		}

		if (mode === 'append') {
			const currentBody = selectedNote.body || '';
			await joplin.data.put(['notes', selectedNote.id], null, {
				body: currentBody + '\n\n' + content,
			});
		} else {
			// Insert at cursor — use commands
			await joplin.commands.execute('insertText', content);
		}

		return { success: true };
	}

	// ================================================================
	// Knowledge Graph queries/mutations from webview
	// ================================================================

	private async handleKGQuery(payload: any): Promise<any> {
		const db = this.kgManager.getDatabase();
		if (!db) return { error: 'No KG loaded. Select a project first.' };

		const { action } = payload;
		switch (action) {
			case 'listScopes':
				return db.listScopes(payload.scopeType, payload.parentScopeId);
			case 'getScope':
				return db.getScope(payload.id);
			case 'listEntities':
				return db.listEntities(payload.filters);
			case 'getEntity':
				return db.getEntity(payload.id);
			case 'getLinksFor':
				return db.getLinksFor(payload.entityId);
			case 'getTagsFor':
				return db.getTagsFor(payload.entityId);
			case 'getConstraintsForScope':
				return db.getConstraintsForScope(payload.scopeId);
			case 'getEntitiesInScopeHierarchy':
				return db.getEntitiesInScopeHierarchy(payload.scopeId, payload.type);
			case 'searchEntities':
				return db.searchEntities(payload.query, payload.limit);
			default:
				return { error: `Unknown KG query action: ${action}` };
		}
	}

	private async handleKGMutate(payload: any): Promise<any> {
		const db = this.kgManager.getDatabase();
		if (!db) return { error: 'No KG loaded. Select a project first.' };

		const { action } = payload;
		let result: any;

		switch (action) {
			case 'createScope':
				result = db.createScope(payload.scopeType, payload.name, payload.parentScopeId, payload.metadata);
				break;
			case 'updateScope':
				db.updateScope(payload.id, payload.updates);
				result = db.getScope(payload.id);
				break;
			case 'deleteScope':
				db.deleteScope(payload.id);
				result = { success: true };
				break;
			case 'createEntity':
				result = db.createEntity(payload.type, payload.scopeId, payload.name, payload.content, payload.structuredFields, payload.status);
				break;
			case 'updateEntity':
				db.updateEntity(payload.id, payload.updates);
				result = db.getEntity(payload.id);
				break;
			case 'deleteEntity':
				db.deleteEntity(payload.id);
				result = { success: true };
				break;
			case 'createLink':
				result = db.createLink(payload.sourceId, payload.targetId, payload.linkType, payload.metadata);
				break;
			case 'deleteLink':
				db.deleteLink(payload.id);
				result = { success: true };
				break;
			case 'addTag':
				result = db.addTag(payload.entityId, payload.tagName);
				break;
			case 'removeTag':
				db.removeTag(payload.entityId, payload.tagName);
				result = { success: true };
				break;
			case 'createSnapshot':
				result = db.createSnapshot(payload.entityId, payload.scopeId, payload.beatIndex, payload.stateData);
				break;
			case 'applyDeltas': {
				const deltas = payload.deltas || [];
				const applied: string[] = [];
				for (const delta of deltas) {
					try {
						// Try to find the entity by name and update it, or create a new one
						const matches = db.searchEntities(delta.entityName, 1);
						if (matches.length > 0) {
							const existing = matches[0];
							const updatedContent = { ...existing.content, _deltaApplied: delta.change };
							db.updateEntity(existing.id, { content: updatedContent, status: 'needs-review' });
							applied.push(`Updated: ${delta.entityName}`);
						} else {
							// Create a new entity as draft
							const scopeId = this.kgManager.getCurrentProject()
								? db.listScopes('WORLD', null)?.[0]?.id || ''
								: '';
							if (scopeId) {
								db.createEntity(
									delta.entityType || 'Event',
									scopeId,
									delta.entityName,
									{ description: delta.change },
									{},
									'draft',
								);
								applied.push(`Created: ${delta.entityName}`);
							}
						}
					} catch (err: any) {
						applied.push(`Error on ${delta.entityName}: ${err.message}`);
					}
				}
				result = { success: true, applied };
				break;
			}
			default:
				return { error: `Unknown KG mutation action: ${action}` };
		}

		this.kgManager.markDirty();
		return result;
	}

	// ================================================================
	// Helpers
	// ================================================================

	private async pushSidebarUpdate(partialState: Record<string, any>): Promise<void> {
		if (this.panelHandle) {
			joplin.views.panels.postMessage(this.panelHandle, {
				type: 'updateState',
				payload: partialState,
			});
		}
	}
}
