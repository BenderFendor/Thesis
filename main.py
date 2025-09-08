from fastapi import FastAPI
import feedparser

rss_url = "https://feeds.bbci.co.uk/news/rss.xml"# Replace with your RSS feed URLfeed 
feed = feedparser.parse(rss_url)
app = FastAPI()

@app.get("/")
async def read_root():
    return {"message": feed}
