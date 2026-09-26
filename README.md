# 溯页 · 论文精读

溯页（PaperBridge）是一个本地优先的英文论文精读工作区。阅读区始终呈现论文原文，学习助手先请读者复述理解，再提供提示、句子拆解和理解反馈，帮助读者沿着解释回到原文证据。

## Run locally

Requirements: Node.js 20 or later.

```bash
npm install
npm run dev
```

Open the Vite URL printed in the terminal (normally `http://127.0.0.1:5173`). The API listens on `http://127.0.0.1:8787` and is bound to loopback only. For a production frontend bundle, run `npm run build`, then `npm start`.

## Learning flow

1. Import a selectable-text PDF (up to 35 MB).
2. Read the extracted English text, page by page, and select a paragraph or a passage.
3. Write an initial interpretation in your own words.
4. Request a hint, a sentence explanation, or a check of your interpretation.
5. Compare the answer with the cited page, revise your understanding, and save the note.

Scanned PDFs need OCR before text-based tutoring. Switch to **PDF 原页** to render the original page inside the workspace, including figures, tables, equations, and page layout. Text mode preserves page references for selecting a passage and asking the tutor.

## AI providers

The server uses the `AIProvider` interface in `server/providers.ts`. The current `OpenAICompatibleProvider` adapter calls a configured Chat Completions endpoint. Add multiple endpoints in Settings and switch between them in the header. Presets only fill a suggested endpoint and model; confirm the model ID with your provider. A new adapter can implement `AIProvider.complete()` and be added to `createProvider()` without changing the learner UI or study endpoints.

Without a configured provider the app runs in demo mode: navigation, notes, paper extraction, and the learning flow work locally, while the tutor makes clear that its responses are instructional placeholders rather than paper-specific AI analysis.

Provider secrets and learning data are stored in `data/store.json`; uploaded PDFs are in `data/uploads/`. These files are excluded from Git. API keys are currently stored as plain text on the local machine, so use this build on a trusted computer only. Before any multi-user or public deployment, replace the JSON store with a protected secret store, add authentication and authorization, isolate per-user data, and review provider data-handling settings.

## API surface

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Service status |
| `GET /api/groups` | List reading groups and document counts |
| `POST /api/groups` | Create a reading group |
| `PATCH /api/groups/:id` | Rename a group |
| `DELETE /api/groups/:id` | Delete a group; its papers move to ungrouped |
| `GET /api/papers` | List papers |
| `POST /api/papers` | Upload and parse a PDF (`multipart/form-data`, field `file`) |
| `GET /api/papers/:id` | Read paper pages and extracted paragraph chunks |
| `GET /api/papers/:id/file` | Serve the original PDF |
| `PATCH /api/papers/:id/group` | Move a paper to a group or to ungrouped |
| `DELETE /api/papers/:id` | Delete a paper, its file, and its learning data |
| `GET /api/notes` | List learning notes grouped by source-paper identity |
| `GET /api/papers/:id/learning` | Read notes and recent tutor turns |
| `POST /api/papers/:id/notes` | Create or update an interpretation note |
| `DELETE /api/notes/:id` | Delete a note |
| `GET /api/providers` | List providers with API keys masked |
| `POST /api/providers` | Add or update an OpenAI-compatible provider |
| `PUT /api/providers/active` | Select provider, or `null` for demo mode |
| `DELETE /api/providers/:id` | Remove a provider |
| `POST /api/providers/:id/test` | Test provider connectivity |
| `POST /api/assistant/turn` | Ground a tutor action in one selected passage and page |

`POST /api/assistant/turn` accepts `paperId`, `page`, `passage`, `learnerAttempt`, and `action` (`hint`, `explain`, or `check`). The backend verifies the passage against the stored page before it is sent to the configured provider.

## Persistence and supported limits

- JSON-backed local data store; uploaded PDF max size: 35 MB.
- Supports text-based PDFs. OCR, multi-user accounts, cloud sync, streaming responses, and native adapters beyond OpenAI-compatible Chat Completions are not included in this first release.
- AI answers are learning aids. Verify interpretations, especially statistical or methodological claims, against the cited paper text.
