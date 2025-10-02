---
trigger: always_on
---

# Copilot Instructions for Thesis Project

This project is a full-stack news aggregation platform with a **FastAPI** backend and a **Next.js** frontend, containerized using Docker Compose. Follow these guidelines to maximize AI agent productivity and maintain project conventions.

## Tools

You can use exa code to get new up to date infomation about any libaries please use that


    get_code_context_exa: 🆕 NEW! Search and get relevant code snippets, examples, and documentation from open source libraries, GitHub repositories, and programming frameworks. Perfect for finding up-to-date code documentation, implementation examples, API usage patterns, and best practices from real codebases.


    web_search_exa: Performs real-time web searches with optimized results and content extraction.
    company_research: Comprehensive company research tool that crawls company websites to gather detailed information about businesses.
    crawling: Extracts content from specific URLs, useful for reading articles, PDFs, or any web page when you have the exact URL.
    linkedin_search: Search LinkedIn for companies and people using Exa AI. Simply include company names, person names, or specific LinkedIn URLs in your query.
    deep_researcher_start: Start a smart AI researcher for complex questions. The AI will search the web, read many sources, and think deeply about your question to create a detailed research report.
    deep_researcher_check: Check if your research is ready and get the results. Use this after starting a research task to see if it's done and get your comprehensive report.



## Architecture Overview
- **Backend**: `backend/app/main.py` (FastAPI, Python 3.11+)
- **Frontend**: `frontend/app/` (Next.js 14, TypeScript, Tailwind CSS)
- **Containerization**: Managed via `docker-compose.yml` for multi-service orchestration
- **API Communication**: Frontend uses `frontend/lib/api.ts` to call backend endpoints (see API base URL logic)

## Developer Workflows
- **Start All Services (Recommended):**
	```bash
	docker compose up --build
	```
- **Manual Backend:**
	```bash
	cd backend
	python -m venv .venv && source .venv/bin/activate
	pip install -r requirements.txt
	uvicorn app.main:app --reload --port 8001
	```
- **Manual Frontend:**
	```bash
	cd frontend
	npm install
	npm run dev
	```
- **Testing:**
	- Backend: `pytest`
	- Frontend: `npm test` (Jest/React Testing Library planned)

## Project Conventions & Patterns
- **React Components:**
	- Use TypeScript, Shadcn UI, and Tailwind CSS
	- Prefer `const` for component declarations
	- Avoid `any` type; use explicit types/interfaces
	- Compose components; avoid deep prop drilling
	- Use server components and server actions when possible
	- Validate all inputs with Zod (server actions, API endpoints)
	- Use custom hooks to encapsulate state/effect logic
	- Use Suspense and streaming for async data
	- Combine related components/hooks in the same file for cohesion
- **API Integration:**
	- Use `frontend/lib/api.ts` for backend calls; respect Docker/localhost switching logic
	- API docs: http://localhost:8001/docs (Swagger)
- **State Management:**
	- Use Zustand for client state (see `Project file.md` for rationale)
- **Styling:**
	- Tailwind CSS is the default; global styles in `frontend/app/globals.css`
- **Testing & Linting:**
	- TypeScript strict mode, ESLint, Prettier enforced

## Integration & External Dependencies
- **Docker Compose**: Orchestrates both frontend and backend; see `docker-compose.yml`
- **Environment Variables**: Set via `.env` files or Docker Compose
- **Frontend/Backend Ports**: 3000 (frontend), 8001 (backend)
- **ChromaDB**: Used for semantic search (future phases)

## Examples
- See `frontend/components/` for composable UI patterns
- See `frontend/lib/api.ts` for API integration logic
- See `backend/app/main.py` for FastAPI entrypoint and route structure

---
For more, see `README.md` and `Project file.md` for architecture, workflows, and roadmap.