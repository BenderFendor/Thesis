import { DEFAULT_ARTICLE_IMAGE, isUsableImage, resolveArticleImage } from "@/lib/article-image";
import { describe, expect, it } from "@jest/globals";

describe("article image contract", () => {
  it("rejects blank, placeholder, and sentinel image values", () => {
    expect.hasAssertions();
    for (const value of [
      undefined,
      null,
      "",
      " none ",
      "/placeholder.svg",
      "https://cdn.test/placeholder.jpg",
    ]) {
      expect(isUsableImage(value)).toBe(false);
    }
    expect(isUsableImage(" https://cdn.test/story.jpg ")).toBe(true);
  });

  it("prefers the usable primary image, then the API image URL, then fallback", () => {
    expect.hasAssertions();
    expect(
      resolveArticleImage({
        image: "https://cdn.test/primary.jpg",
        image_url: "https://cdn.test/api.jpg",
      }),
    ).toBe("https://cdn.test/primary.jpg");
    expect(resolveArticleImage({ image: "none", image_url: "https://cdn.test/api.jpg" })).toBe(
      "https://cdn.test/api.jpg",
    );
    expect(resolveArticleImage({ image: "", image_url: null })).toBe(DEFAULT_ARTICLE_IMAGE);
  });
});
