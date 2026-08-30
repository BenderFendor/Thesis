from app.services.reporter_public_records import extract_article_author_candidates


def test_extract_article_author_candidates_combines_structured_metadata_microdata_and_links() -> (
    None
):
    html = """
    <html><head>
      <script type="application/ld+json">
      {
        "@type": "NewsArticle",
        "author": {
          "@type": "Person",
          "name": "Alice Example",
          "url": "/authors/alice-example",
          "sameAs": ["https://social.example/alice"]
        },
        "publisher": {"@type": "Organization", "name": "Example Publishing"}
      }
      </script>
      <meta name="author" content="Alice Example, Bob Example">
      <meta property="article:publisher" content="Example Publishing">
      <meta property="og:site_name" content="Example News">
    </head><body>
      <span itemprop="author">Carol Example</span>
      <a rel="author" href="/authors/alice-example">Alice Example</a>
      <a href="/authors/dana-example">Dana Example</a>
    </body></html>
    """

    result = extract_article_author_candidates(html, "https://news.example/story")

    assert result == {
        "names": ["Alice Example", "Bob Example", "Carol Example", "Dana Example"],
        "author_pages": [
            "https://news.example/authors/alice-example",
            "https://news.example/authors/dana-example",
        ],
        "social_links": ["https://social.example/alice"],
        "structured_person_names": ["Alice Example"],
        "microdata_author_names": ["Carol Example"],
        "metadata_author_names": ["Alice Example", "Bob Example"],
        "publisher_names": ["Example Publishing"],
        "site_names": ["Example News"],
    }
