# Thesis Project

A full-stack news aggregation platform that provides diverse global perspectives on current events, built with **FastAPI** backend and **Next.js** frontend, containerized with Docker.

## 🏗️ Architecture

- **Backend**: FastAPI (Python) with ChromaDB
- **Frontend**: Next.js (React/TypeScript)
- **Containerization**: Docker & Docker Compose
- **Environment**: Python virtual environments (.venv)

## 🚀 Features

- **Multi-source News Aggregation**: RSS feeds from BBC, CNN, Reuters, NPR, Fox News, and Associated Press
- **AI-Powered Article Analysis**: Deep analysis using Google Gemini AI including:
  - Full article text extraction
  - Source credibility assessment
  - Reporter background and bias detection
  - Tone, framing, and selection bias analysis
  - Fact-check suggestions for key claims
- **Category Filtering**: Browse news by different categories (General, Politics, Technology, Sports, etc.)
- **Real-time Search**: Search across all articles in real-time with instant results
- **Source Transparency**: View source funding and bias ratings for informed reading
- **Responsive Design**: Optimized for desktop, tablet, and mobile devices
- **Modern UI**: Clean, modern interface with dark mode support
- **Loading States**: Smooth loading animations and skeleton screens
- **Error Handling**: Graceful error handling with user-friendly messages

## 🛠️ Tech Stack

### Backend
- **FastAPI** - High-performance Python web framework
- **Google Gemini AI** - Advanced AI for article analysis and bias detection
- **Newspaper3k** - Article content extraction and parsing
- **ChromaDB** - Vector database for semantic search
- **Feedparser** - RSS feed parsing and processing
- **Pydantic** - Data validation and serialization
- **Uvicorn** - ASGI server for production deployment

### Frontend
- **Next.js 14** - React framework with App Router
- **TypeScript** - Type-safe development environment
- **Tailwind CSS** - Utility-first CSS framework
- **Lucide React** - Beautiful and consistent icons
- **React Hooks** - Modern state management

### Development & Deployment
- **Docker** - Containerization for easy deployment
- **Docker Compose** - Multi-container orchestration
- **ESLint** - Code linting and formatting

## 📁 Project Structure

```
Thesis/
├── backend/
│   ├── app/
│   │   └── main.py
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── app/            # Next.js pages
│   │   ├── components/     # React components
│   │   └── types/          # TypeScript definitions
│   ├── Dockerfile
│   └── package.json
├── docker-compose.yml
└── README.md
```

## 🚀 Quick Start

### Prerequisites

- Docker & Docker Compose
- Node.js (for local development)
- Python 3.9+ (for local development)
- **Google Gemini API Key** - Get one from [Google AI Studio](https://makersuite.google.com/app/apikey)

### Running with Docker (Recommended)

1. **Clone and navigate to the project**
   ```bash
   git clone <repository-url>
   cd Thesis
   ```

2. **Configure environment variables**
   ```bash
   cd backend
   cp .env.example .env
   # Edit .env and add your GEMINI_API_KEY
   ```

3. **Start all services**
   ```bash
   docker compose up --build
   ```

4. **Access the application**
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:8001
   - API Documentation: http://localhost:8001/docs

### Local Development

#### Backend Setup
```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Linux/Mac
pip install -r requirements.txt

# Configure environment variables
cp .env.example .env
# Edit .env and add your GEMINI_API_KEY

uvicorn app.main:app --reload --port 8001
```

#### Frontend Setup

#### Frontend Setup
```bash
cd frontend
npm install
npm run dev
```

## 🛠️ Development Commands

### Docker Commands
```bash
# Start services
docker compose up

# Build and start
docker compose up --build

# Run in background
docker compose up -d

# Stop services
docker compose down

# View logs
docker compose logs -f [service-name]
```

### Backend Commands
```bash
# Install dependencies
pip install -r requirements.txt

# Run tests
pytest

# Format code
black .
```

### Frontend Commands
```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Run tests
npm test
```

## 🔧 Configuration

- Backend runs on port `8001`
- Frontend runs on port `3000`
- API base URL: `http://localhost:8001`

## 📝 API Documentation

When the backend is running, visit:
- Swagger UI: http://localhost:8001/docs
- ReDoc: http://localhost:8001/redoc

## 🐛 Troubleshooting

### Common Issues

1. **Port conflicts**: Ensure ports 3000 and 8001 are available
2. **Docker build fails**: Try `docker compose down && docker compose up --build`
3. **Permission issues**: On Linux, you might need to run with `sudo`

### Reset Everything
```bash
docker compose down -v
docker system prune -f
docker compose up --build
```

### Prerequisites
- **Node.js 18+** - For frontend development
- **Python 3.11+** - For backend development
- **Docker & Docker Compose** - For containerized deployment (recommended)
- **Git** - For version control

### Method 1: Docker (Recommended)

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd thesis-news-platform
   ```

2. **Start with Docker Compose**:
   ```bash
   docker-compose up --build
   ```
   
   This will:
   - Build both frontend and backend containers
   - Start the services with hot reload enabled
   - Set up the development environment automatically

3. **Access the application**:
   - **Frontend**: http://localhost:3000
   - **Backend API**: http://localhost:8001
   - **API Documentation**: http://localhost:8001/docs
   - **API Health Check**: http://localhost:8001/health

### Method 2: Manual Setup

#### Backend Setup
1. **Navigate to backend directory**:
   ```bash
   cd backend
   ```

2. **Create virtual environment**:
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

4. **Start the backend server**:
   ```bash
   uvicorn app.main:app --reload --host 0.0.0.0 --port 8001
   ```

#### Frontend Setup
1. **Navigate to frontend directory**:
   ```bash
   cd frontend
   ```

2. **Install dependencies**:
   ```bash
   npm install
   # or
   yarn install
   ```

3. **Start the development server**:
   ```bash
   npm run dev
   # or
   yarn dev
   ```

4. **Access the frontend**:
   - Frontend: http://localhost:3000

## � Docker Configuration

The project includes optimized Docker configurations:

- **Backend Dockerfile**: Multi-stage build for Python FastAPI application
- **Frontend Dockerfile**: Optimized Node.js build with hot reload support
- **Docker Compose**: Orchestrates both services with proper networking and volumes
- **Development Volumes**: Live code reloading for both frontend and backend
- **Environment Variables**: Configurable through Docker Compose

## �📚 API Endpoints

### Core Endpoints
- `GET /` - API status and information
- `GET /health` - Health check endpoint
- `GET /news/stream` - Stream news articles with real-time updates
- `GET /news/source/{source_name}` - Get news from specific source
- `GET /news/category/{category}` - Get news by category
- `GET /sources` - Get all available sources with metadata
- `GET /categories` - Get all available categories
- `POST /api/article/analyze` - Analyze article with AI (requires Gemini API key)

### Query Parameters
- `limit` - Number of articles to return (default: 50)
- `category` - Filter by category (general, politics, technology, etc.)
- `search` - Search in article titles and descriptions

### Example API Calls

```bash
# Get all news with limit
curl "http://localhost:8001/news?limit=10"

# Get politics news only
curl "http://localhost:8001/news?category=politics&limit=10"

# Get news from BBC
curl "http://localhost:8001/news/source/BBC"

# Get all sources with transparency info
curl "http://localhost:8001/sources"

# Health check
curl "http://localhost:8001/health"

# Analyze an article with AI
curl -X POST "http://localhost:8001/api/article/analyze" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/article", "source_name": "Example News"}'
```

## 🤖 AI Article Analysis Feature

The platform includes an advanced AI-powered article analysis feature using Google's Gemini AI:

### Features
- **Full Article Extraction**: Automatically extracts complete article text from any URL
- **Source Analysis**: Evaluates source credibility, ownership, funding model, and political leaning
- **Reporter Background**: Provides information about the article's authors and their expertise
- **Bias Detection**: Analyzes tone, framing, selection bias, and source diversity
- **Fact-Check Suggestions**: Identifies key claims that should be fact-checked
- **AI Summary**: Generates concise summaries of articles

### How to Use
1. Click on any article in the news feed
2. In the article detail modal, click the **"AI Analysis"** button (purple sparkle icon)
3. Wait 10-30 seconds for the AI to analyze the article
4. View comprehensive analysis including:
   - Article summary
   - Source credibility assessment
   - Reporter background and biases
   - Bias analysis with scoring
   - Fact-check suggestions

### Setup Requirements
1. Get a free Gemini API key from [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Add the key to your `.env` file in the backend directory:
   ```
   GEMINI_API_KEY=your_api_key_here
   ```
3. Restart the backend server

### Technical Details
- **Backend**: FastAPI endpoint at `/api/article/analyze`
- **Article Extraction**: Uses `newspaper3k` library for content parsing
- **AI Model**: Google Gemini Pro for analysis
- **Response Time**: 10-30 seconds depending on article length
- **Rate Limits**: Subject to Gemini API rate limits (check Google AI Studio)
```

## 🎯 Development Phases & Roadmap

### ✅ Phase 1: MVP (Completed)
- [x] FastAPI backend with RSS parsing
- [x] Next.js frontend with modern UI
- [x] Multi-source news aggregation
- [x] Category-based filtering
- [x] Real-time search functionality
- [x] Source transparency information
- [x] Responsive design with dark mode
- [x] Docker containerization
- [x] API documentation with Swagger

### � Phase 2: Enhanced Features (In Progress)
- [ ] ChromaDB integration for article similarity detection
- [ ] User preferences and bookmarking system
- [ ] PWA functionality with offline support
- [ ] Push notifications for breaking news
- [ ] Advanced search with filters and sorting
- [ ] Article sharing and social features
- [ ] Performance optimizations and caching

### 🌍 Phase 3: Global Expansion (Planned)
- [ ] Interactive 3D globe interface with Three.js
- [ ] International news sources integration
- [ ] Multi-language support and translation
- [ ] Regional news filtering by geography
- [ ] Cultural context and bias analysis
- [ ] Time zone-aware news delivery

### 🔍 Phase 4: Advanced Intelligence (Future)
- [ ] Local LLM integration for content analysis
- [ ] Automated fact-checking system
- [ ] AI-powered content summarization
- [ ] Sentiment analysis and trend detection
- [ ] Web scraper for verification and updates
- [ ] Machine learning for personalized recommendations

## 🛠️ Development

### Code Quality
- **TypeScript**: Strict type checking enabled
- **ESLint**: Consistent code style and error detection
- **Prettier**: Automated code formatting
- **Git Hooks**: Pre-commit validation

### Testing (Planned)
- **Frontend**: Jest and React Testing Library
- **Backend**: pytest with coverage reporting
- **E2E**: Playwright for end-to-end testing
- **API**: Automated API testing with pytest

### Performance
- **Frontend**: Next.js optimizations, lazy loading, code splitting
- **Backend**: FastAPI async operations, caching strategies
- **Database**: Efficient querying and indexing (future phases)

## 🚀 Deployment

### Production Deployment
```bash
# Build production images
docker-compose -f docker-compose.prod.yml build

# Deploy to production
docker-compose -f docker-compose.prod.yml up -d
```

### Environment Variables
Create `.env` files for different environments:
- `.env.local` - Local development
- `.env.production` - Production settings
- `.env.test` - Testing environment

## 🤝 Contributing

We welcome contributions! Please follow these steps:

1. **Fork the repository**
2. **Create a feature branch**:
   ```bash
   git checkout -b feature/amazing-feature
   ```
3. **Make your changes** with proper commit messages
4. **Test your changes** thoroughly
5. **Push to your branch**:
   ```bash
   git push origin feature/amazing-feature
   ```
6. **Open a Pull Request** with a clear description

### Contribution Guidelines
- Follow the existing code style and conventions
- Add tests for new features
- Update documentation as needed
- Ensure all checks pass before submitting PR

## � License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🔗 Useful Links

- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [Next.js Documentation](https://nextjs.org/docs)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [Docker Documentation](https://docs.docker.com/)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)

## 📞 Support

If you encounter any issues or have questions:
1. Check the [Issues](../../issues) page for existing problems
2. Create a new issue with detailed information
3. Include steps to reproduce any bugs
4. Provide system information and error logs

---

**Built with ❤️ for better news consumption and media literacy**
