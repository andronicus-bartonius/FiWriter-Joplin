# FiRiter — AI Screenwriting Copilot for Joplin

An AI-powered screenwriting copilot that combines structured storyboarding, a Knowledge Graph for canon management, and retrieval-augmented generation to help writers plan, draft, revise, and enforce story consistency — all inside Joplin.

## Features

### Knowledge Graph (KG)
- **Scoped entity management** — organise characters, locations, arcs, rules, items, and events into hierarchical scopes (World → Season → Episode → Scene)
- **Full-text search** via FTS5 for instant canon lookup
- **Links, tags, and snapshots** to track relationships and state at specific beats
- **Auto-save & sync** — KG is persisted as a Joplin resource and syncs across devices

### Storyboard
- **Drag-and-drop card interface** for visual entity management
- **Scope breadcrumb navigation** through your story hierarchy
- **Inline card inspector** for editing entity details, tags, and relationships
- **Search & filter** entities by type

### Work Modes (Workflow Engine)

All work modes are powered by a lightweight DAG runner with conditional branching, cycles, progress tracking, and cancellation support.

| Work Mode | Description |
|---|---|
| **Outline → Scene Draft** | 9-node pipeline: identify context → gather KG constraints → RAG retrieval → generate draft → continuity check → propose canon deltas → revise → evaluate → finalise with citations |
| **Brainstorm Beats** | Analyse story state → generate N beat candidates → optionally expand a selected beat into sub-beats |
| **Dialogue Refinement** | Analyse character voice patterns → retrieve reference samples → refine dialogue → evaluate distinctiveness and naturalness |
| **Continuity Repair** | Audit text against canon → identify contradictions → auto-repair → generate structured report |

### RAG (Retrieval-Augmented Generation)
- **BM25 keyword search** via MiniSearch for fast local retrieval
- **Optional embedding search** with cosine similarity (requires an embedding endpoint)
- **Reciprocal Rank Fusion** merges BM25 and embedding results
- **Incremental index updates** every 2 minutes

### Output Review
- **Tabbed dialog** with preview, evaluation scores, canon update proposals, and citations
- **Accept/reject individual canon updates** before applying to the KG
- **Insert, append, or save as new note** actions

## Requirements

- **Joplin** ≥ 3.5 (desktop)
- **An OpenAI-compatible LLM endpoint** — works with:
  - [Ollama](https://ollama.ai)
  - [LM Studio](https://lmstudio.ai)
  - [llama.cpp server](https://github.com/ggerganov/llama.cpp)
  - [vLLM](https://github.com/vllm-project/vllm)
  - [text-generation-webui](https://github.com/oobabooga/text-generation-webui)
  - OpenAI API, Anthropic (via proxy), or any `/v1/chat/completions` endpoint

## Installation

### From JPL file
1. Download `FiRiter.Joplin.jpl` from the [Releases](https://github.com/andronicus-bartonius/joplin-plugin-firiter/releases) page
2. In Joplin: **Tools → Options → Plugins → Install from file**
3. Select the `.jpl` file and restart Joplin

### From source
```bash
git clone https://github.com/andronicus-bartonius/joplin-plugin-firiter.git
cd joplin-plugin-firiter
npm install
npm run dist
```
Then install `publish/FiRiter.Joplin.jpl` in Joplin as above.

## Configuration

After installing, go to **Tools → Options → FiRiter** and configure:

| Setting | Description |
|---|---|
| **LLM Base URL** | Your LLM server endpoint (e.g. `http://localhost:11434`) |
| **API Key** | Optional — only needed for authenticated endpoints |
| **Model Name** | The model to use for generation (e.g. `llama3.1:8b`) |
| **Embedding Endpoint** | Optional — separate endpoint for embeddings |
| **Embedding Model** | Optional — model name for embedding requests |

## Usage

### Getting Started
1. **Configure your LLM** in plugin settings
2. **Create a project** via the FiRiter sidebar (toggle with the pen icon in the toolbar)
3. **Select notebooks** that belong to your project
4. **Open the storyboard** to set up your world bible — add characters, locations, arcs, and rules

### Running a Workflow
1. Open the FiRiter sidebar
2. Select a work mode
3. Provide the required input (outline text, dialogue passage, etc.)
4. The workflow runs in the background with node-by-node progress updates
5. When complete, the **Output Review** dialog opens automatically
6. Review the output, accept/reject canon updates, and insert the result into your notes

### Keyboard Shortcuts
- **Toggle Sidebar** — configurable via Joplin's keyboard shortcut settings (`firiter.toggleSidebar`)
- **Open Storyboard** — `firiter.openStoryboard`
- **Test Connection** — `firiter.testConnection`
- **Rebuild RAG Index** — `firiter.rebuildIndex`

## Architecture

```
src/
├── index.ts                    Main entry — wires all services
├── core/
│   ├── types.ts                Shared type definitions
│   ├── settings.ts             Plugin settings registration
│   ├── project-registry.ts     Multi-project CRUD
│   └── message-handler.ts      Plugin ↔ webview message router
├── providers/
│   └── llm-provider.ts         OpenAI-compatible LLM client
├── kg/
│   ├── schema.ts               SQLite DDL (scopes, entities, links, tags, snapshots, FTS5)
│   ├── kg-database.ts          KGDatabase — full CRUD over sql.js
│   └── kg-manager.ts           Lifecycle: load/save KG to Joplin resources
├── rag/
│   ├── rag-index.ts            BM25 search via MiniSearch
│   ├── rag-builder.ts          Full & incremental index builder
│   ├── embedding-index.ts      Optional vector similarity search
│   └── retrieval.ts            Unified API with Reciprocal Rank Fusion
├── workflows/
│   ├── dag-runner.ts           Generic DAG executor
│   ├── prompt-templates.ts     Template engine + all built-in prompts
│   ├── scene-draft.ts          Outline → Scene Draft (9 nodes)
│   ├── brainstorm-beats.ts     Beat generation workflow
│   ├── dialogue-refine.ts      Dialogue refinement workflow
│   └── continuity-repair.ts    Continuity audit & repair workflow
└── ui/
    ├── sidebar/
    │   ├── panel.css            Catppuccin-inspired theme
    │   └── panel.js             Sidebar webview (vanilla JS)
    ├── storyboard/
    │   ├── storyboard.css       Storyboard dialog styles
    │   └── storyboard.tsx       Preact storyboard component
    └── output-review/
        ├── output-review.css    Output review dialog styles
        └── output-review.tsx    Preact output review component
```

## Tech Stack
- **TypeScript** — strict mode
- **Preact** — lightweight JSX for dialog webviews
- **sql.js** — WASM SQLite for the Knowledge Graph
- **MiniSearch** — BM25 full-text search for RAG
- **Webpack 5** — bundling with separate main/webview pipelines

## License

MIT
