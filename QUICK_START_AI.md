# Quick Start: AI Article Analysis

## 🚀 Get Started in 3 Steps

### 1. Get Your API Key (2 minutes)
```
Visit: https://makersuite.google.com/app/apikey
→ Sign in with Google
→ Click "Create API Key"
→ Copy the key
```

### 2. Configure Backend (1 minute)
```bash
cd backend
cp .env.example .env
# Edit .env and paste your key:
# GEMINI_API_KEY=your_key_here
```

### 3. Restart Services
```bash
# If using Docker:
docker compose down
docker compose up --build

# If running locally:
# Restart your backend server
```

## ✅ Test It Works

1. Open http://localhost:3000
2. Click any article
3. Click the purple **"AI Analysis"** button
4. Wait ~15 seconds
5. See the magic! ✨

## 📋 What You Get

- ✅ Full article text extraction
- ✅ Source credibility assessment  
- ✅ Reporter background & biases
- ✅ Tone, framing, selection bias analysis
- ✅ Fact-check suggestions
- ✅ AI-generated summary

## 🆓 Free Tier Limits

- 60 requests/minute
- 1,500 requests/day
- 1M tokens/month

Perfect for development and testing!

## 🐛 Troubleshooting

**"API key not configured"**
→ Check `.env` file exists and has correct key
→ Restart backend server

**Analysis fails**
→ Some sites block scraping (paywalls, etc.)
→ Try a different article

**Takes forever**
→ Normal: 10-30 seconds
→ Check internet connection
→ Check backend logs

## 📚 Full Documentation

See `AI_ANALYSIS_SETUP.md` for complete details.

---

**Happy analyzing! 🎉**
