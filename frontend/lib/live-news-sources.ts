interface LiveNewsSource {
  readonly channelId: string
  readonly defaultMuted: boolean
  readonly enabled: boolean
  readonly id: string
  readonly label: string
  readonly priority: number
  readonly region: string
  readonly thumbnailUrl: string
}

const DEFAULT_SOURCES: readonly LiveNewsSource[] = [
  {
    channelId: "UCNye-wNBqNL5ZzHSJj3l8Bg",
    defaultMuted: true,
    enabled: true,
    id: "al-jazeera-english",
    label: "Al Jazeera English",
    priority: 0,
    region: "middle-east",
    thumbnailUrl:
      "https://yt3.googleusercontent.com/ytc/AIdro_nRzT2KpNfB1H5W7-JxJhLJ8kGZ-YGqM9K3VxW3nQ=s176-c-k-c0x00ffffff-no-rj",
  },
  {
    channelId: "UCmJb7lEQRZ1PfLB2W8qCEgQ",
    defaultMuted: true,
    enabled: true,
    id: "france-24",
    label: "France 24 English",
    priority: 1,
    region: "europe",
    thumbnailUrl:
      "https://yt3.googleusercontent.com/ytc/AIdro_lMG1yYcDgVFByKJEXWN4DFH0KUb7EIXAEHnKJ4=s176-c-k-c0x00ffffff-no-rj",
  },
  {
    channelId: "UCknLrEdhRCp1aegoMqRaCZg",
    defaultMuted: true,
    enabled: true,
    id: "dw-news",
    label: "DW News",
    priority: 2,
    region: "europe",
    thumbnailUrl:
      "https://yt3.googleusercontent.com/ytc/AIdro_kKhKNlPiOmqHV-C0n3DzJYPLqFh4JLmhB7-JpF=s176-c-k-c0x00ffffff-no-rj",
  },
  {
    channelId: "UC7fBqVfpodFWv2uKJvhZpSQ",
    defaultMuted: true,
    enabled: true,
    id: "cgtn",
    label: "CGTN",
    priority: 3,
    region: "asia",
    thumbnailUrl:
      "https://yt3.googleusercontent.com/ytc/AIdro_mUc0QKoN1Qe2-J6KqPQOvV7j9Jj5ch5-WqAQ=s176-c-k-c0x00ffffff-no-rj",
  },
  {
    channelId: "UC16niRr50-MSBwiO3YDb3RA",
    defaultMuted: true,
    enabled: true,
    id: "bbc-news",
    label: "BBC News",
    priority: 4,
    region: "europe",
    thumbnailUrl:
      "https://yt3.googleusercontent.com/ytc/AIdro_nFp-JbRgPDB4qV1fY4ZfJYV7FgP5c1Jm3Yw=s176-c-k-c0x00ffffff-no-rj",
  },
  {
    channelId: "UCoMdKTg2e2qMk2WNKJrGN7A",
    defaultMuted: true,
    enabled: true,
    id: "sky-news",
    label: "Sky News",
    priority: 5,
    region: "europe",
    thumbnailUrl:
      "https://yt3.googleusercontent.com/ytc/AIdro_mA1rPjPQJ-SLxJhQpz5L9JeR8GpGpH0q5dZA=s176-c-k-c0x00ffffff-no-rj",
  },
  {
    channelId: "UC7fWeaHhqgM4Ry-RMpMGeSA",
    defaultMuted: true,
    enabled: true,
    id: "trt-world",
    label: "TRT World",
    priority: 6,
    region: "middle-east",
    thumbnailUrl:
      "https://yt3.googleusercontent.com/ytc/AIdro_mG1ZCbb0TLo2RzDZn7uHw6uROHmNj0-WqnIw=s176-c-k-c0x00ffffff-no-rj",
  },
  {
    channelId: "UC7gFsm3o7jQEmGQjUJivwSA",
    defaultMuted: true,
    enabled: true,
    id: "wion",
    label: "WION",
    priority: 7,
    region: "asia",
    thumbnailUrl:
      "https://yt3.googleusercontent.com/ytc/AIdro_mVcI0jq5DURBYOOpL2kJbJ5dV-_sK7SRJ0=s176-c-k-c0x00ffffff-no-rj",
  },
  {
    channelId: "UChqUTb7rEAej43Bv-ZJ5TPQ",
    defaultMuted: true,
    enabled: true,
    id: "reuters",
    label: "Reuters",
    priority: 8,
    region: "global",
    thumbnailUrl:
      "https://yt3.googleusercontent.com/ytc/AIdro_nT09mYXKWG_iXpMsdFrTJ6fI1U8AHk5W_-Uw=s176-c-k-c0x00ffffff-no-rj",
  },
],
getDefaultSources = (): LiveNewsSource[] =>
  DEFAULT_SOURCES.map((source) => structuredClone(source)),
getSourceById = (
  id: string,
  sources: readonly LiveNewsSource[],
): LiveNewsSource | undefined => sources.find((source) => source.id === id);

export { getDefaultSources, getSourceById }
export type { LiveNewsSource }
