# Relayqo WhatsApp Chatbot Backend

A multi-tenant WhatsApp chatbot backend built with Node.js, Express, TypeScript, Prisma ORM, and PostgreSQL (`pgvector`). It routes each WhatsApp number to the correct client account, processes messages through a durable queue, and supports Meta Cloud API plus an optional QR transport.

This repository contains the Relayqo chatbot backend, its admin/client portals, WhatsApp integrations, and supporting services.

---

## Getting Started

### 1. Start Local Database
```bash
npm run db:dev
```

### 2. Start Development Server
```bash
npm run dev
```
The server will start on `http://localhost:3000/`.
When `ENABLE_DEV_CONTROL_CENTER=true`, the Developer Control Center is available at `http://localhost:3000/`.

### 3. Run Tests
```bash
npm test
```

---

## Project Layout

| Path | Purpose |
| :--- | :--- |
| `src/` | Chatbot API, conversation engine, WhatsApp integration, and admin UI |
| `prisma/` | Database schema and migrations |
| `tests/` | Unit and integration tests |
| `apps/image-service/` | Optional image understanding service |
| `apps/monitoring-service/` | Monitoring service |
| `packages/shared/` | Contracts shared by the services |
| `docs/` | Relayqo architecture, operations, and audit documents |
| `scripts/` | Reusable setup, verification, and maintenance tools |

## Utility & Maintenance Scripts

Reusable operational and maintenance scripts live in the `scripts/` directory:

| Command | Script | Description |
| :--- | :--- | :--- |
| `npm run db:extract` | [`scripts/extract-db.js`](scripts/extract-db.js) | Dumps extracted text from all `KnowledgeChunks` in the database. |
| `npm run tenant:enable-rag` | [`scripts/enable-rag.js`](scripts/enable-rag.js) | Enables knowledge retrieval (`knowledge.enabled = true`) for a tenant. |
| `npm run rag:benchmark` | [`scripts/benchmark-rag.js`](scripts/benchmark-rag.js) | Runs a 16-query cosine similarity distribution benchmark. |
| `npm run rag:seed` | [`scripts/seed-rag.js`](scripts/seed-rag.js) | Generates and ingests the default test knowledge document. |

---

## Development & Investigation Guidelines

> **Script Organization Policy:**
> One-off debug/investigation scripts go in `scripts/debug/` and should be deleted once the investigation is resolved — never left in the project root.
> The `scripts/debug/` directory is ignored by git in `.gitignore`.
