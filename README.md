# Multi-Tenant AI Chatbot & RAG Engine

A configurable multi-tenant conversational chatbot and RAG (Retrieval-Augmented Generation) engine built with Node.js, Express, TypeScript, Prisma ORM, and PostgreSQL (`pgvector`).

---

## 🚀 Getting Started

### 1. Start Local Database
```bash
npm run db:dev
```

### 2. Start Development Server
```bash
npm run dev
```
The server will start on `http://localhost:3000/`.
The **Developer Control Center** UI is available at `http://localhost:3000/`.

### 3. Run Tests
```bash
npm test
```

---

## 🛠️ Utility & Maintenance Scripts

Reusable operational and maintenance scripts live in the `scripts/` directory:

| Command | Script | Description |
| :--- | :--- | :--- |
| `npm run db:extract` | [`scripts/extract-db.js`](scripts/extract-db.js) | Dumps extracted text from all `KnowledgeChunks` in the database. |
| `npm run tenant:enable-rag` | [`scripts/enable-rag.js`](scripts/enable-rag.js) | Enables knowledge retrieval (`knowledge.enabled = true`) for a tenant. |
| `npm run rag:benchmark` | [`scripts/benchmark-rag.js`](scripts/benchmark-rag.js) | Runs a 16-query cosine similarity distribution benchmark. |
| `npm run rag:seed` | [`scripts/seed-rag.js`](scripts/seed-rag.js) | Generates and ingests the default test knowledge document. |

---

## 📁 Development & Investigation Guidelines

> **Script Organization Policy:**
> One-off debug/investigation scripts go in `scripts/debug/` and should be deleted once the investigation is resolved — never left in the project root.
> The `scripts/debug/` directory is ignored by git in `.gitignore`.
