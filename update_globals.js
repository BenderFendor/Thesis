const fs = require('fs');
const content = fs.readFileSync('frontend/app/globals.css', 'utf8');

let newContent = content.replace(/:root {[\s\S]*?--news-card-bg: var\(--card\);\n}/, `:root {
  /* Warm Archival Palette */
  --pitch-black: #0c0c0a;
  --dark-spruce: #1c1c1a;
  --sand: #c4b88b;
  --sand-2: #e0d5ad;
  --fern: #8c8261;
  --dusty-olive: #6b6b64;
  
  --destructive-red: #ff453a;

  /* Light Mode (Warm Paper / Archival) */
  --background: #fdfdf9;
  --foreground: #141412;
  
  --card: #ffffff;
  --card-foreground: #141412;
  
  --popover: #ffffff;
  --popover-foreground: #141412;
  
  --primary: #8c8261;
  --primary-foreground: #ffffff;
  
  --secondary: #f0f0ea;
  --secondary-foreground: #141412;
  
  --muted: #f0f0ea;
  --muted-foreground: #6b6b64;
  
  --accent: #c4b88b;
  --accent-foreground: #141412;
  
  --destructive: var(--destructive-red);
  --destructive-foreground: #ffffff;
  
  --border: #e0e0d8;
  --input: #f0f0ea;
  --ring: #8c8261;
  
  /* Sharp editorial corners */
  --radius: 0rem;

  --sidebar: #fdfdf9;
  --sidebar-foreground: #141412;
  --sidebar-primary: #8c8261;
  --sidebar-primary-foreground: #ffffff;
  --sidebar-accent: #f0f0ea;
  --sidebar-accent-foreground: #141412;
  --sidebar-border: #e0e0d8;
  --sidebar-ring: #8c8261;

  --chart-1: #8c8261;
  --chart-2: #c4b88b;
  --chart-3: #141412;
  --chart-4: #6b6b64;
  --chart-5: #1c1c1a;

  --news-bg-primary: var(--background);
  --news-bg-secondary: #ffffff;
  --news-card-bg: var(--card);
}`);

newContent = newContent.replace(/\.dark {[\s\S]*?--news-card-bg: var\(--card\);\n}/, `.dark {
  /* Dark Mode (High Contrast Archival) */
  --background: #0d0d0c;
  --foreground: #e6e6e1;
  
  --card: #151513; 
  --card-foreground: #e6e6e1;
  
  --popover: #0d0d0c;
  --popover-foreground: #e6e6e1;
  
  --primary: #c2b588;
  --primary-foreground: #0d0d0c;
  
  --secondary: #20201c;
  --secondary-foreground: #e6e6e1;
  
  --muted: #20201c;
  --muted-foreground: #8a8a83;
  
  --accent: #8c8261;
  --accent-foreground: #ffffff;
  
  --destructive: var(--destructive-red);
  --destructive-foreground: #0d0d0c;
  
  --border: #292925;
  --input: #20201c;
  --ring: #c2b588;

  --sidebar: #0d0d0c;
  --sidebar-foreground: #e6e6e1;
  --sidebar-primary: #c2b588;
  --sidebar-primary-foreground: #0d0d0c;
  --sidebar-accent: #20201c;
  --sidebar-accent-foreground: #e6e6e1;
  --sidebar-border: #292925;
  --sidebar-ring: #c2b588;

  --chart-1: #c2b588;
  --chart-2: #e0d5ad;
  --chart-3: #8c8261;
  --chart-4: #8a8a83;
  --chart-5: #1c1c1a;

  --news-bg-primary: var(--background);
  --news-bg-secondary: #151513;
  --news-card-bg: var(--card);
}`);

fs.writeFileSync('frontend/app/globals.css', newContent);
