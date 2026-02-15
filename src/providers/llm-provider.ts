import {
	LLMProvider,
	LLMProviderConfig,
	LLMCompletionRequest,
	LLMCompletionResponse,
	LLMEmbeddingRequest,
	LLMEmbeddingResponse,
	StreamChunkCallback,
} from '../core/types';

/**
 * OpenAI-compatible LLM provider.
 * Works with Ollama, llama.cpp, LM Studio, vLLM, text-generation-webui,
 * and any server exposing /v1/chat/completions.
 */
export class OpenAICompatProvider implements LLMProvider {
	readonly name = 'openai-compat';
	private config: LLMProviderConfig | null = null;

	configure(config: LLMProviderConfig): void {
		this.config = {
			...config,
			baseUrl: config.baseUrl.replace(/\/+$/, ''),
		};
	}

	private getConfig(): LLMProviderConfig {
		if (!this.config) {
			throw new Error('LLM provider not configured. Set a base URL in plugin settings.');
		}
		return this.config;
	}

	private buildHeaders(): Record<string, string> {
		const cfg = this.getConfig();
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		};
		if (cfg.apiKey) {
			headers['Authorization'] = `Bearer ${cfg.apiKey}`;
		}
		return headers;
	}

	async complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse> {
		const cfg = this.getConfig();
		const url = `${cfg.baseUrl}/v1/chat/completions`;

		const body: Record<string, any> = {
			model: request.model || cfg.model,
			messages: request.messages,
		};

		if (request.temperature !== undefined) body.temperature = request.temperature;
		if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
		if (request.stop !== undefined) body.stop = request.stop;
		body.stream = false;

		// Use request signal if provided, otherwise apply a 5-minute timeout
		const signal = request.signal ?? AbortSignal.timeout(300_000);

		const response = await fetch(url, {
			method: 'POST',
			headers: this.buildHeaders(),
			body: JSON.stringify(body),
			signal,
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`LLM request failed (${response.status}): ${errorText}`);
		}

		const data = await response.json();
		const choice = data.choices?.[0];

		return {
			content: choice?.message?.content ?? '',
			finishReason: choice?.finish_reason ?? null,
			usage: data.usage
				? {
						promptTokens: data.usage.prompt_tokens ?? 0,
						completionTokens: data.usage.completion_tokens ?? 0,
						totalTokens: data.usage.total_tokens ?? 0,
					}
				: undefined,
		};
	}

	async completeStream(
		request: LLMCompletionRequest,
		onChunk: StreamChunkCallback,
		signal?: AbortSignal,
	): Promise<LLMCompletionResponse> {
		const cfg = this.getConfig();
		const url = `${cfg.baseUrl}/v1/chat/completions`;

		const body: Record<string, any> = {
			model: request.model || cfg.model,
			messages: request.messages,
			stream: true,
		};

		if (request.temperature !== undefined) body.temperature = request.temperature;
		if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
		if (request.stop !== undefined) body.stop = request.stop;

		const response = await fetch(url, {
			method: 'POST',
			headers: this.buildHeaders(),
			body: JSON.stringify(body),
			signal,
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`LLM stream request failed (${response.status}): ${errorText}`);
		}

		const reader = response.body?.getReader();
		if (!reader) {
			throw new Error('Response body is not readable (streaming not supported)');
		}

		const decoder = new TextDecoder();
		let fullContent = '';
		let finishReason: string | null = null;
		let buffer = '';

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed || !trimmed.startsWith('data: ')) continue;

					const data = trimmed.slice(6);
					if (data === '[DONE]') {
						onChunk('', true);
						break;
					}

					try {
						const parsed = JSON.parse(data);
						const delta = parsed.choices?.[0]?.delta;
						const chunk = delta?.content || '';
						finishReason = parsed.choices?.[0]?.finish_reason || finishReason;

						if (chunk) {
							fullContent += chunk;
							onChunk(chunk, false);
						}

						if (finishReason) {
							onChunk('', true);
						}
					} catch {
						// Skip malformed SSE lines
					}
				}
			}
		} finally {
			reader.releaseLock();
		}

		return {
			content: fullContent,
			finishReason,
		};
	}

	async embed(request: LLMEmbeddingRequest): Promise<LLMEmbeddingResponse> {
		const cfg = this.getConfig();
		const baseUrl = cfg.embeddingEndpoint
			? cfg.embeddingEndpoint.replace(/\/+$/, '')
			: cfg.baseUrl;
		const url = `${baseUrl}/v1/embeddings`;

		const body: Record<string, any> = {
			model: request.model || cfg.embeddingModel || cfg.model,
			input: request.input,
		};

		const response = await fetch(url, {
			method: 'POST',
			headers: this.buildHeaders(),
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Embedding request failed (${response.status}): ${errorText}`);
		}

		const data = await response.json();
		const embeddings = (data.data || []).map((d: any) => d.embedding);

		return {
			embeddings,
			usage: data.usage
				? {
						promptTokens: data.usage.prompt_tokens ?? 0,
						totalTokens: data.usage.total_tokens ?? 0,
					}
				: undefined,
		};
	}

	async testConnection(): Promise<{ ok: boolean; error?: string }> {
		try {
			const cfg = this.getConfig();
			const url = `${cfg.baseUrl}/v1/models`;

			const response = await fetch(url, {
				method: 'GET',
				headers: this.buildHeaders(),
			});

			if (!response.ok) {
				const errorText = await response.text();
				return { ok: false, error: `HTTP ${response.status}: ${errorText}` };
			}

			return { ok: true };
		} catch (err: any) {
			return { ok: false, error: err.message || String(err) };
		}
	}
}

/**
 * Creates the default LLM provider instance.
 */
export function createDefaultProvider(): LLMProvider {
	return new OpenAICompatProvider();
}
