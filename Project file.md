# Global News Aggregation Platform

## 🎯 Current Phase: **Phase 1 - MVP Development (In Progress)**

### Tech Stack Decisions (Finalized)
- **Backend**: FastAPI (Python) - Better for rapid prototyping and ML integration
- **Frontend**: Next.js 14 with TypeScript + Tailwind CSS - PWA ready
- **Database**: PostgreSQL + ChromaDB (vector similarity search)
- **Deployment**: Docker containers

### Vision
Create a comprehensive news aggregation platform that provides diverse global perspectives on current events, focusing initially on American politics but expandable to international sources and multiple categories (games, fashion, hobbies, etc.).

## 🚀 Development Phases

### ✅ Phase 1: MVP - American News Focus (Current)
**Status**: ✅ **COMPLETED** - Backend and Frontend MVP Ready

**Features**:
- [x] FastAPI backend with RSS feed parsing
- [x] Multiple US news sources (BBC, CNN, Reuters, NPR, Fox News, AP)
- [x] Next.js frontend with Tailwind CSS
- [x] Basic news display with categories
- [x] Source filtering and search
- [x] Responsive design for mobile/desktop
- [x] Source funding transparency display
- [x] Docker containerization

**Current Project Structure**:
```
thesis-news-platform/
├── backend/
│   ├── app/
│   │   └── main.py          # FastAPI with 6 news sources
│   ├── requirements.txt     # Python dependencies
│   └── Dockerfile          # Backend container
├── frontend/
│   ├── src/
│   │   ├── app/page.tsx     # Main news page
│   │   ├── components/      # NewsCard, CategoryTabs
│   │   └── types/           # TypeScript definitions
│   ├── package.json         # Next.js + Tailwind + Zustand
│   └── Dockerfile          # Frontend container
├── docker-compose.yml       # Full dev environment
└── README.md               # Complete setup guide
```

**🎉 Ready to Run**:
```bash
cd thesis-news-platform
docker-compose up --build
# Frontend: http://localhost:3000
# API: http://localhost:8000/docs
```

### 📋 Phase 2: Enhanced Features (Next)
- Source funding transparency display
- Article similarity clustering with ChromaDB
- Basic categorization algorithm
- User preferences and bookmarking
- PWA functionality for mobile installation

### 🌍 Phase 3: Global Expansion
- Interactive 3D globe with Three.js
- International news sources by country
- Translation service integration
- Multi-language support (English → Spanish priority)

### 🔍 Phase 4: Advanced Intelligence
- Local LLM integration for article summarization
- Fact-checking system integration
- AI-powered content analysis
- Web scraper for additional fact verification

## 🏗️ Technical Architecture

### Why Next.js over other frameworks?
- **SSR/SSG**: Better SEO for news content
- **PWA Support**: Built-in service workers for mobile app experience
- **API Routes**: Can handle some backend logic if needed
- **TypeScript**: Better code quality and developer experience
- **Vercel Deployment**: Easy hosting and CI/CD

### State Management Strategy
Using **Zustand** for client state (lightweight, simple to learn)
- Article preferences
- User settings
- UI state (selected categories, filters)

### PWA Implementation
- **Service Workers**: Cache articles for offline reading
- **Web App Manifest**: Install like native app
- **Push Notifications**: Breaking news alerts
- **Background Sync**: Update articles when connection restored

# The Design of the website
Frontend could be next.js remix or sometihng like vue.js *I really don't know the difference between this frontends and why I would or wouldnt use one*

Three.js for the 3d globe idea I have

Styling *I should probably *

Vector Databases like chromaDB or sometihng lke that from similarity searching would also be useful.

*Also look up what State Management is becuase I haveIno idea what that is im guessing like saving all the information that you had on the page for it.*

Also I would like a frontend framework with a PWA function but with that Im guessing you would have to abstract the backend as you ca't run that on the local phone so idk how you would code. *Just make it a api or something that you would add to the frontend web app part.*

For things that I need something that is really performative I could use rust for smaller parts of the program.

## Focus on just news and maybe even just american.