export const navLinks = [
  {
    title: "Categories",
    links: [
      { title: "Politics", href: "#" },
      { title: "Games", href: "#" },
      { title: "Fashion", href: "#" },
    ],
  },
  {
    title: "Features",
    links: [
      { title: "Interactive 3D Globe", href: "#" },
      { title: "Source Credibility", href: "#" },
      { title: "Multi-View Interface", href: "#" },
    ],
  },
  {
    title: "About",
    links: [
      { title: "Privacy Policy", href: "#" },
      { title: "Terms of Service", href: "#" },
      { title: "Contact Us", href: "#" },
    ],
  },
];

// Feature flags for gradual rollout
export const FEATURE_FLAGS = {
  USE_PAGINATION: process.env.NEXT_PUBLIC_USE_PAGINATION === "true",
  USE_VIRTUALIZATION: process.env.NEXT_PUBLIC_USE_VIRTUALIZATION === "true",
  PAGINATION_PAGE_SIZE: parseInt(
    process.env.NEXT_PUBLIC_PAGINATION_PAGE_SIZE || "50",
    10
  ),
};
