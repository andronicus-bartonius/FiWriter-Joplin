import { RAGSearchResult, LLMProvider } from '../core/types';
import { RAGIndex } from './rag-index';
import { EmbeddingIndex } from './embedding-index';

/**
 * Unified retrieval API that merges BM25 keyword search
 * with optional embedding-based vector search.
 *
 * Results are combined using reciprocal rank fusion (RRF)
 * with configurable weighting between the two sources.
 */
export class RetrievalAPI {
	private ragIndex: RAGIndex;
	private embeddingIndex: EmbeddingIndex;
	private bm25Weight: number = 0.6;
	private embeddingWeight: number = 0.4;

	constructor(ragIndex: RAGIndex, embeddingIndex: EmbeddingIndex) {
		this.ragIndex = ragIndex;
		this.embeddingIndex = embeddingIndex;
	}

	setWeights(bm25: number, embedding: number): void {
		const total = bm25 + embedding;
		this.bm25Weight = bm25 / total;
		this.embeddingWeight = embedding / total;
	}

	/**
	 * Search for relevant snippets using available retrieval methods.
	 * If embeddings are available, merges BM25 + embedding results via RRF.
	 * Otherwise, falls back to BM25 only.
	 */
	async search(query: string, maxResults: number = 10): Promise<RAGSearchResult[]> {
		const bm25Results = this.ragIndex.search(query, maxResults * 2);

		if (!this.embeddingIndex.isAvailable || this.embeddingIndex.documentCount === 0) {
			return bm25Results.slice(0, maxResults);
		}

		const embeddingResults = await this.embeddingIndex.search(query, maxResults * 2);

		if (embeddingResults.length === 0) {
			return bm25Results.slice(0, maxResults);
		}

		return this.mergeResults(bm25Results, embeddingResults, maxResults);
	}

	/**
	 * Merge BM25 and embedding results using Reciprocal Rank Fusion.
	 * RRF score = sum(weight / (k + rank)) across result lists.
	 */
	private mergeResults(
		bm25Results: RAGSearchResult[],
		embeddingResults: RAGSearchResult[],
		maxResults: number,
	): RAGSearchResult[] {
		const k = 60; // RRF constant
		const scoreMap = new Map<string, { score: number; result: RAGSearchResult }>();

		// Score BM25 results
		bm25Results.forEach((result, rank) => {
			const rrfScore = this.bm25Weight / (k + rank + 1);
			const existing = scoreMap.get(result.documentId);
			if (existing) {
				existing.score += rrfScore;
			} else {
				scoreMap.set(result.documentId, {
					score: rrfScore,
					result: { ...result, source: 'merged' },
				});
			}
		});

		// Score embedding results
		embeddingResults.forEach((result, rank) => {
			const rrfScore = this.embeddingWeight / (k + rank + 1);
			const existing = scoreMap.get(result.documentId);
			if (existing) {
				existing.score += rrfScore;
				existing.result.source = 'merged';
			} else {
				scoreMap.set(result.documentId, {
					score: rrfScore,
					result: { ...result, source: 'merged' },
				});
			}
		});

		// Sort by fused score and return top results
		return Array.from(scoreMap.values())
			.sort((a, b) => b.score - a.score)
			.slice(0, maxResults)
			.map(({ score, result }) => ({ ...result, score }));
	}

	get stats(): { bm25Docs: number; embeddingDocs: number; embeddingAvailable: boolean } {
		return {
			bm25Docs: this.ragIndex.documentCount,
			embeddingDocs: this.embeddingIndex.documentCount,
			embeddingAvailable: this.embeddingIndex.isAvailable,
		};
	}
}
