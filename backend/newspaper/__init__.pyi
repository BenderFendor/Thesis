from datetime import datetime

class Config:
    browser_user_agent: str
    request_timeout: int | float

    def __init__(self) -> None: ...

class Article:
    html: str | None
    text: str
    title: str
    authors: list[str]
    publish_date: datetime | None
    top_image: str
    images: set[str]
    keywords: list[str]
    meta_description: str | None

    def __init__(self, url: str, config: Config | None = ...) -> None: ...
    def download(self) -> None: ...
    def parse(self) -> None: ...
