import {
	WorkflowGraph,
	WorkflowState,
	WorkflowContext,
	WorkflowRunResult,
	WorkflowNodeId,
	WorkflowStatus,
	WorkflowEdge,
	WorkflowNode,
} from '../core/types';

const DEFAULT_MAX_ITERATIONS = 50;

/**
 * Lightweight DAG runner for iterative generation pipelines.
 *
 * Supports:
 * - Conditional edges (branching)
 * - Cycles (regeneration loops)
 * - Human-in-the-loop breakpoints (via context.onBreakpoint)
 * - Cancellation (via context.signal)
 * - Progress callbacks
 */
export class DAGRunner<S extends WorkflowState = WorkflowState> {
	private graph: WorkflowGraph<S>;
	private status: WorkflowStatus = 'idle';

	constructor(graph: WorkflowGraph<S>) {
		this.graph = graph;
	}

	getStatus(): WorkflowStatus {
		return this.status;
	}

	async run(initialState: S, context: WorkflowContext): Promise<WorkflowRunResult<S>> {
		const maxIter = this.graph.maxIterations ?? DEFAULT_MAX_ITERATIONS;
		const nodesVisited: WorkflowNodeId[] = [];
		let currentNodeId: WorkflowNodeId | null = this.graph.entryNode;
		let state = { ...initialState };
		let iterations = 0;

		this.status = 'running';

		try {
			while (currentNodeId !== null && iterations < maxIter) {
				if (context.signal?.aborted) {
					this.status = 'cancelled';
					return { status: 'cancelled', finalState: state, nodesVisited };
				}

				const node = this.findNode(currentNodeId);
				if (!node) {
					throw new Error(`Node not found: ${currentNodeId}`);
				}

				nodesVisited.push(currentNodeId);

				// Execute the node
				state = await node.execute(state, context);

				// Report progress
				if (context.onProgress) {
					context.onProgress(currentNodeId, state);
				}

				// Check for breakpoint (human-in-the-loop)
				if (context.onBreakpoint && (state as any).__breakpoint) {
					this.status = 'paused';
					delete (state as any).__breakpoint;
					state = (await context.onBreakpoint(currentNodeId, state)) as S;
					this.status = 'running';

					if (context.signal?.aborted) {
						this.status = 'cancelled';
						return { status: 'cancelled', finalState: state, nodesVisited };
					}
				}

				// Resolve the next node via edges
				currentNodeId = this.resolveNextNode(currentNodeId, state);
				iterations++;
			}

			if (iterations >= maxIter) {
				this.status = 'error';
				return {
					status: 'error',
					finalState: state,
					nodesVisited,
					error: `Max iterations (${maxIter}) exceeded`,
				};
			}

			this.status = 'completed';
			return { status: 'completed', finalState: state, nodesVisited };
		} catch (err: any) {
			this.status = 'error';
			return {
				status: 'error',
				finalState: state,
				nodesVisited,
				error: err.message || String(err),
			};
		}
	}

	private findNode(id: WorkflowNodeId): WorkflowNode<S> | undefined {
		return this.graph.nodes.find((n) => n.id === id);
	}

	private resolveNextNode(fromId: WorkflowNodeId, state: S): WorkflowNodeId | null {
		const edges = this.graph.edges.filter((e: WorkflowEdge) => e.from === fromId);

		if (edges.length === 0) {
			return null; // Terminal node
		}

		// Evaluate conditional edges first, fall back to unconditional
		for (const edge of edges) {
			if (edge.condition && edge.condition(state)) {
				return edge.to;
			}
		}

		// If no conditional edge matched, use the first unconditional edge
		const unconditional = edges.find((e: WorkflowEdge) => !e.condition);
		return unconditional ? unconditional.to : null;
	}
}
