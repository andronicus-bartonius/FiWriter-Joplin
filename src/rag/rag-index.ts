// eslint-disable-next-line @typescript-eslint/no-var-requires
const MiniSearch = require('minisearch');
import { RAGDocument, RAGSearchResult } from '../core/types';

/**
 * RAG index using MiniSearch for BM25 keyword retrieval.
 * Optional embedding-based vector search can be layered on top
 * when an embedding endpoint is configured.
 */
export class RAGIndex {
	private miniSearch: any;
	private documents: Map<string, RAGDocument> = new Map();

	constructor() {
		this.miniSearch = new MiniSearch({
			fields: ['title', 'content'],
			storeFields: ['title', 'noteId', 'notebookId'],
			searchOptions: {
				boost: { title: 2 },
				fuzzy: 0.2,
				prefix: true,
			},
		});
	}

	addDocument(doc: RAGDocument): void {
		if (this.documents.has(doc.id)) {
			this.miniSearch.discard(doc.id);
		}
		this.documents.set(doc.id, doc);
		this.miniSearch.add(doc);
	}

	addDocuments(docs: RAGDocument[]): void {
		for (const doc of docs) {
			this.addDocument(doc);
		}
	}

	removeDocument(id: string): void {
		if (this.documents.has(id)) {
			this.miniSearch.discard(id);
			this.documents.delete(id);
		}
	}

	clear(): void {
		this.miniSearch.removeAll();
		this.documents.clear();
	}

	get documentCount(): number {
		return this.documents.size;
	}

	/**
	 * Search the index using BM25 keyword matching.
	 * Returns ranked snippets with source attribution.
	 */
	search(query: string, maxResults: number = 10): RAGSearchResult[] {
		const results = this.miniSearch.search(query, { limit: maxResults });

		return results.map((result: any) => {
			const doc = this.documents.get(result.id);
			const snippet = doc ? this.extractSnippet(doc.content, query) : '';

			return {
				documentId: result.id,
				noteId: doc?.noteId ?? '',
				title: doc?.title ?? '',
				snippet,
				score: result.score,
				source: 'bm25' as const,
			};
		});
	}

	/**
	 * Extract a relevant snippet from the document content around query terms.
	 */
	private extractSnippet(content: string, query: string, windowSize: number = 200): string {
		const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
		const lowerContent = content.toLowerCase();

		let bestPos = 0;
		let bestScore = 0;
		for (const term of terms) {
			const idx = lowerContent.indexOf(term);
			if (idx >= 0 && idx < content.length) {
				const score = terms.filter((t) => {
					const nearby = lowerContent.substring(
						Math.max(0, idx - windowSize / 2),
						Math.min(content.length, idx + windowSize / 2),
					);
					return nearby.includes(t);
				}).length;
				if (score > bestScore) {
					bestScore = score;
					bestPos = idx;
				}
			}
		}

		const start = Math.max(0, bestPos - windowSize / 2);
		const end = Math.min(content.length, bestPos + windowSize / 2);
		let snippet = content.substring(start, end).trim();
		if (start > 0) snippet = '...' + snippet;
		if (end < content.length) snippet = snippet + '...';

		return snippet;
	}
}
