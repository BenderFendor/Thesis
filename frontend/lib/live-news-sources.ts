export interface LiveNewsSource {
  id: string
  label: string
  channelId: string
  thumbnailUrl: string
  region: string
  defaultMuted: boolean
  enabled: boolean
  priority: number
}

const DEFAULT_SOURCES: LiveNewsSource[] = [
  {
    id: "al-jazeera-english",
    label: "Al Jazeera English",
    channelId: "UCNye-wNBqNL5ZzHSJj3l8Bg",
    thumbnailUrl:
      "https://yt3.googleusercontent.com/ytc/AIdro_nRzT2KpNfB1H5W7-JxJhLJ8kGZ-YGqM9K3VxW3nQ=s176-c-k-c0x00ffffff-no-rj",
    region: "middle-east",
    defaultMuted: true,
    enabled: true,
    priority: 0,
  },
  {
    id: "france-24",
    label: "France 24 English",
    channelId: "UCmJb7lEQRZ1PfLB2W8qCEgQ",
    thumbnailUrl:
      "https://yt3.googleusercontent.com/ytc/AIdro_lMG1yYcDgVFByKJEXWN4DFH0KUb7EIXAEHnKJ4=s176-c-k-c0x00ffffff-no-rj",
    region: "europe",
    defaultMuted: true,
    enabled: true,
    priority: 1,
  },
  {
    id: "dw-news",
    label: "DW News",
    channelId: "UCknLrEdhRCp1aegoMqRaCZg",
    thumbnailUrl:
      "https://yt3.googleusercontent.com/ytc/AIdro_kKhKNlPiOmqHV-C0n3DzJYPLqFh4JLmhB7-JpF=s176-c-k-c0x00ffffff-no-rj",
    region: "europe",
    defaultMuted: true,
    enabled: true,
    priority: 2,
  },
  {
    id: "cgtn",
    label: "CGTN",
    channelId: "UC7fBqVfpodFWv2uKJvhZpSQ",
    thumbnailUrl:
      "https://yt3.googleusercontent.com/ytc/AIdro_mUc0QKoN1Qe2-J6KqPQOvV7j9Jj5ch5-WqAQ=s176-c-k-c0x00ffffff-no-rj",
    region: "asia",
    defaultMuted: true,
    enabled: true,
    priority: 3,
  },
  {
    id: "bbc-news",
    label: "BBC News",
    channelId: "UC16niRr50-MSBwiO3YDb3RA",
    thumbnailUrl:
      "https://yt3.googleusercontent.com/ytc/AIdro_nFp-JbRgPDB4qV1fY4ZfJYV7FgP5c1Jm3Yw=s176-c-k-c0x00ffffff-no-rj",
    region: "europe",
    defaultMuted: true,
    enabled: true,
    priority: 4,
  },
  {
    id: "sky-news",
    label: "Sky News",
    channelId: "UCoMdKTg2e2qMk2WNKJrGN7A",
    thumbnailUrl:
      "https://yt3.googleusercontent.com/ytc/AIdro_mA1rPjPQJ-SLxJhQpz5L9JeR8GpGpH0q5dZA=s176-c-k-c0x00ffffff-no-rj",
    region: "europe",
    defaultMuted: true,
    enabled: true,
    priority: 5,
  },
  {
    id: "trt-world",
    label: "TRT World",
    channelId: "UC7fWeaHhqgM4Ry-RMpMGeSA",
    thumbnailUrl:
      "https://yt3.googleusercontent.com/ytc/AIdro_mG1ZCbb0TLo2RzDZn7uHw6uROHmNj0-WqnIw=s176-c-k-c0x00ffffff-no-rj",
    region: "middle-east",
    defaultMuted: true,
    enabled: true,
    priority: 6,
  },
  {
    id: "wion",
    label: "WION",
    channelId: "UC7gFsm3o7jQEmGQjUJivwSA",
    thumbnailUrl:
      "https://yt3.googleusercontent.com/ytc/AIdro_mVcI0jq5DURBYOOpL2kJbJ5dV-_sK7SRJ0=s176-c-k-c0x00ffffff-no-rj",
    region: "asia",
    defaultMuted: true,
    enabled: true,
    priority: 7,
  },
  {
    id: "reuters",
    label: "Reuters",
    channelId: "UChqUTb7rEAej43Bv-ZJ5TPQ",
    thumbnailUrl:
      "https://yt3.googleusercontent.com/ytc/AIdro_nT09mYXKWG_iXpMsdFrTJ6fI1U8AHk5W_-Uw=s176-c-k-c0x00ffffff-no-rj",
    region: "global",
    defaultMuted: true,
    enabled: true,
    priority: 8,
  },
]

export function getDefaultSources(): LiveNewsSource[] {
  return DEFAULT_SOURCES.map((s) => ({ ...s }))
}

export function getSourceById(
  id: string,
  sources: LiveNewsSource[],
): LiveNewsSource | undefined {
  return sources.find((s) => s.id === id)
}
