# Global News Aggregation Platform

A comprehensive news aggregation platform that provides diverse global perspectives on current events, built with FastAPI and Next.js. This platform aggregates news from multiple sources and presents them in a clean, modern interface with powerful filtering and search capabilities.

## 🚀 Features

- **Multi-source News Aggregation**: RSS feeds from BBC, CNN, Reuters, NPR, Fox News, and Associated Press
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
- **Feedparser** - RSS feed parsing and processing
- **Pydantic** - Data validation and serialization
- **Uvicorn** - ASGI server for production deployment
- **CORS** - Cross-origin resource sharing support

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
- **Git** - Version control with comprehensive .gitignore

## 📁 Project Structure

```
thesis-news-platform/
├── backend/
│   ├── app/
│   │   └── main.py          # FastAPI application
│   ├── requirements.txt     # Python dependencies
│   └── Dockerfile          # Backend container
├── frontend/
│   ├── src/
│   │   ├── app/            # Next.js app directory
│   │   ├── components/     # React components
│   │   └── types/          # TypeScript type definitions
│   ├── package.json        # Node.js dependencies
│   └── Dockerfile          # Frontend container
├── docker-compose.yml      # Development environment
└── README.md              # Project documentation
```

## 🚀 Quick Start

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
- `GET /news` - Get all news articles with optional filtering
- `GET /news/source/{source_name}` - Get news from specific source
- `GET /news/category/{category}` - Get news by category
- `GET /sources` - Get all available sources with metadata
- `GET /categories` - Get all available categories

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
