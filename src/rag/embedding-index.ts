import { LLMProvider, RAGSearchResult } from '../core/types';

/**
 * Optional embedding-based vector search index.
 * Stores document embeddings and supports cosine similarity search.
 * Activated when an embedding-capable LLM endpoint is configured.
 */

interface EmbeddingEntry {
	documentId: string;
	noteId: string;
	title: string;
	content: string;
	vector: number[];
}

export class EmbeddingIndex {
	private entries: Map<string, EmbeddingEntry> = new Map();
	private llmProvider: LLMProvider | null = null;
	private dimensions: number = 0;

	setProvider(provider: LLMProvider): void {
		this.llmProvider = provider;
	}

	get isAvailable(): boolean {
		return this.llmProvider !== null && typeof this.llmProvider.embed === 'function';
	}

	get documentCount(): number {
		return this.entries.size;
	}

	/**
	 * Add a document to the embedding index.
	 * Computes the embedding vector via the LLM provider.
	 */
	async addDocument(doc: { id: string; noteId: string; title: string; content: string }): Promise<void> {
		if (!this.llmProvider || !this.llmProvider.embed) {
			throw new Error('Embedding provider not available');
		}

		// Truncate content to avoid token limits (roughly 8k chars)
		const text = `${doc.title}\n\n${doc.content}`.substring(0, 8000);

		try {
			const response = await this.llmProvider.embed({ input: text });
			if (response.embeddings && response.embeddings.length > 0) {
				const vector = response.embeddings[0];
				this.dimensions = vector.length;
				this.entries.set(doc.id, {
					documentId: doc.id,
					noteId: doc.noteId,
					title: doc.title,
					content: doc.content,
					vector,
				});
			}
		} catch (err: any) {
			console.error(`[FiRiter Embedding] Failed to embed document ${doc.id}: ${err.message}`);
		}
	}

	/**
	 * Remove a document from the embedding index.
	 */
	removeDocument(id: string): void {
		this.entries.delete(id);
	}

	/**
	 * Clear all stored embeddings.
	 */
	clear(): void {
		this.entries.clear();
		this.dimensions = 0;
	}

	/**
	 * Search by cosine similarity against a query string.
	 */
	async search(query: string, maxResults: number = 10): Promise<RAGSearchResult[]> {
		if (!this.llmProvider || !this.llmProvider.embed || this.entries.size === 0) {
			return [];
		}

		try {
			const response = await this.llmProvider.embed({ input: query });
			if (!response.embeddings || response.embeddings.length === 0) return [];

			const queryVector = response.embeddings[0];
			const scored: { entry: EmbeddingEntry; score: number }[] = [];

			for (const entry of this.entries.values()) {
				const similarity = cosineSimilarity(queryVector, entry.vector);
				scored.push({ entry, score: similarity });
			}

			scored.sort((a, b) => b.score - a.score);

			return scored.slice(0, maxResults).map(({ entry, score }) => ({
				documentId: entry.documentId,
				noteId: entry.noteId,
				title: entry.title,
				snippet: entry.content.substring(0, 200),
				score,
				source: 'embedding' as const,
			}));
		} catch (err: any) {
			console.error(`[FiRiter Embedding] Search failed: ${err.message}`);
			return [];
		}
	}
}

/**
 * Cosine similarity between two vectors.
 */
function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length || a.length === 0) return 0;

	let dotProduct = 0;
	let normA = 0;
	let normB = 0;

	for (let i = 0; i < a.length; i++) {
		dotProduct += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}

	const denominator = Math.sqrt(normA) * Math.sqrt(normB);
	if (denominator === 0) return 0;
	return dotProduct / denominator;
}
