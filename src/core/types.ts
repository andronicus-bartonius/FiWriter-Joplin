// Core type definitions shared across all modules

// ============================================================
// Project Registry Types
// ============================================================

export interface ProjectConfig {
	id: string;
	name: string;
	notebookIds: string[];
	tagIds: string[];
	kgResourceId: string | null;
	kgNoteId: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface ProjectRegistry {
	activeProjectId: string | null;
	projects: ProjectConfig[];
}

// ============================================================
// Knowledge Graph Entity Types
// ============================================================

export type EntityType =
	| 'Character'
	| 'Location'
	| 'Rule'
	| 'Item'
	| 'Arc'
	| 'Relationship'
	| 'Beat'
	| 'Event'
	| 'Thread';

export type ScopeType = 'WORLD' | 'SEASON' | 'EPISODE' | 'SCENE';

export type EntityStatus = 'canon' | 'draft' | 'needs-review' | 'archived';

export type LinkType =
	| 'connected_to'
	| 'depends_on'
	| 'transitions_to'
	| 'references'
	| 'parent_of'
	| 'child_of'
	| 'evolves_into';

export interface KGEntity {
	id: string;
	type: EntityType;
	scopeId: string;
	name: string;
	content: Record<string, any>;
	structuredFields: Record<string, any>;
	status: EntityStatus;
	createdAt: string;
	updatedAt: string;
}

export interface KGLink {
	id: string;
	sourceId: string;
	targetId: string;
	linkType: LinkType;
	metadata: Record<string, any>;
}

export interface KGTag {
	id: string;
	entityId: string;
	tagName: string;
}

export interface KGScope {
	id: string;
	parentScopeId: string | null;
	scopeType: ScopeType;
	name: string;
	metadata: Record<string, any>;
}

export interface KGStateSnapshot {
	id: string;
	entityId: string;
	scopeId: string;
	beatIndex: number;
	stateData: Record<string, any>;
}

// ============================================================
// LLM Provider Types
// ============================================================

export interface LLMMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export interface LLMCompletionRequest {
	messages: LLMMessage[];
	model?: string;
	temperature?: number;
	maxTokens?: number;
	stop?: string[];
	stream?: boolean;
	signal?: AbortSignal;
}

export interface LLMCompletionResponse {
	content: string;
	finishReason: string | null;
	usage?: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
	};
}

export interface LLMEmbeddingRequest {
	input: string | string[];
	model?: string;
}

export interface LLMEmbeddingResponse {
	embeddings: number[][];
	usage?: {
		promptTokens: number;
		totalTokens: number;
	};
}

export interface LLMProviderConfig {
	baseUrl: string;
	apiKey?: string;
	model: string;
	embeddingModel?: string;
	embeddingEndpoint?: string;
}

export type StreamChunkCallback = (chunk: string, done: boolean) => void;

export interface LLMProvider {
	readonly name: string;
	configure(config: LLMProviderConfig): void;
	complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse>;
	completeStream(request: LLMCompletionRequest, onChunk: StreamChunkCallback, signal?: AbortSignal): Promise<LLMCompletionResponse>;
	embed?(request: LLMEmbeddingRequest): Promise<LLMEmbeddingResponse>;
	testConnection(): Promise<{ ok: boolean; error?: string }>;
}

// ============================================================
// Workflow Engine Types
// ============================================================

export type WorkflowNodeId = string;

export interface WorkflowState {
	[key: string]: any;
}

export type WorkflowNodeFn<S extends WorkflowState = WorkflowState> = (
	state: S,
	context: WorkflowContext,
) => Promise<S>;

export interface WorkflowNode<S extends WorkflowState = WorkflowState> {
	id: WorkflowNodeId;
	name: string;
	execute: WorkflowNodeFn<S>;
}

export interface WorkflowEdge {
	from: WorkflowNodeId;
	to: WorkflowNodeId;
	condition?: (state: WorkflowState) => boolean;
}

export interface WorkflowGraph<S extends WorkflowState = WorkflowState> {
	id: string;
	name: string;
	entryNode: WorkflowNodeId;
	nodes: WorkflowNode<S>[];
	edges: WorkflowEdge[];
	maxIterations?: number;
}

export interface WorkflowContext {
	llm: LLMProvider;
	kg?: any; // KGDatabase instance — typed as any to avoid circular import
	rag?: any; // RetrievalAPI instance
	signal?: AbortSignal;
	onProgress?: (nodeId: WorkflowNodeId, state: WorkflowState) => void;
	onBreakpoint?: (nodeId: WorkflowNodeId, state: WorkflowState) => Promise<WorkflowState>;
}

export type WorkflowStatus = 'idle' | 'running' | 'paused' | 'completed' | 'error' | 'cancelled';

export interface WorkflowRunResult<S extends WorkflowState = WorkflowState> {
	status: WorkflowStatus;
	finalState: S;
	error?: string;
	nodesVisited: WorkflowNodeId[];
}

// ============================================================
// RAG Types
// ============================================================

export interface RAGDocument {
	id: string;
	noteId: string;
	title: string;
	content: string;
	notebookId?: string;
}

export interface RAGSearchResult {
	documentId: string;
	noteId: string;
	title: string;
	snippet: string;
	score: number;
	source: 'bm25' | 'embedding' | 'merged';
}

// ============================================================
// UI Message Types (plugin <-> webview bridge)
// ============================================================

export type MessageType =
	| 'getState'
	| 'setState'
	| 'kgQuery'
	| 'kgMutate'
	| 'runWorkflow'
	| 'cancelWorkflow'
	| 'ragSearch'
	| 'getProjects'
	| 'setActiveProject'
	| 'createProject'
	| 'updateProject'
	| 'deleteProject'
	| 'insertToNote'
	| 'getSettings'
	| 'testConnection'
	| 'openStoryboard'
	| 'openOutputReview'
	| 'workflowProgress'
	| 'workflowComplete'
	| 'workflowError';

export interface PluginMessage {
	type: MessageType;
	payload?: any;
	requestId?: string;
}
