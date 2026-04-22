const fs = require('fs');
const file = '/home/bender/classwork/Thesis/frontend/app/wiki/page.tsx';
let content = fs.readFileSync(file, 'utf-8');

content = content.replace(
  'import { Search, ArrowUpDown, Filter, BookOpen, ChevronLeft, Loader2 } from "lucide-react";',
  'import { Search, ArrowUpDown, Filter, BookOpen, ChevronLeft, Loader2, List, Database, Activity } from "lucide-react";'
);

content = content.replace(
  `function MiniRadar({ scores }: { scores: Record<string, number> | null | undefined }) {
  if (!scores || Object.keys(scores).length === 0) {
    return (
      <div className="w-16 h-16 flex items-center justify-center text-[10px] text-muted-foreground border border-white/5 rounded">
        N/A
      </div>
    );
  }

  const size = 64;
  const cx = size / 2;
  const cy = size / 2;
  const maxR = 26;
  const axes = ANALYSIS_AXES;
  const n = axes.length;

  // Polygon points for max (ring at 5)
  const ringPoints = axes.map((_, i) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    return \`\${cx + maxR * Math.cos(angle)},\${cy + maxR * Math.sin(angle)}\`;
  });`,
  `function MiniRadar({ scores }: { scores: Record<string, number> | null | undefined }) {
  const size = 64;
  const cx = size / 2;
  const cy = size / 2;
  const maxR = 26;
  const axes = ANALYSIS_AXES;
  const n = axes.length;

  // Polygon points for max (ring at 5)
  const ringPoints = axes.map((_, i) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    return \`\${cx + maxR * Math.cos(angle)},\${cy + maxR * Math.sin(angle)}\`;
  });

  if (!scores || Object.keys(scores).length === 0) {
    return (
      <svg width={size} height={size} viewBox={\`0 0 \${size} \${size}\`} className="shrink-0">
        <polygon
          points={ringPoints.join(" ")}
          fill="none"
          stroke="rgba(255,255,255,0.04)"
          strokeWidth="0.5"
        />
        {axes.map((_, i) => {
          const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
          return (
            <line
              key={i}
              x1={cx}
              y1={cy}
              x2={cx + maxR * Math.cos(angle)}
              y2={cy + maxR * Math.sin(angle)}
              stroke="rgba(255,255,255,0.03)"
              strokeWidth="0.5"
            />
          );
        })}
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fill="rgba(255,255,255,0.3)" fontSize="8" fontFamily="monospace" fontWeight="bold" letterSpacing="0.05em">
          NO DATA
        </text>
      </svg>
    );
  }`
);

const oldSourceCard = \`function SourceCard({ source }: { source: WikiSourceCard }) {
  const avgScore = useMemo(() => {
    if (!source.analysis_scores) return null;
    const vals = Object.values(source.analysis_scores);
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }, [source.analysis_scores]);

  return (
    <Link
      href={\`/wiki/source/\${encodeURIComponent(source.name)}\`}
      className="group block bg-black/20 border border-white/5 transition-all duration-500 hover:bg-white/[0.03] rounded-2xl p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            {source.country && (
              <span className="text-sm" title={source.country}>
                {countryCodeLabel(source.country)}
              </span>
            )}
            <h3 className="font-serif text-sm font-semibold text-foreground truncate group-hover:text-white">
              {source.name}
            </h3>
          </div>

          <div className="flex flex-wrap gap-1 mt-2">
            {source.bias_rating && (
              <span className={\`inline-flex px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider border rounded-sm \${biasBadgeClass(source.bias_rating)}\`}>
                {source.bias_rating}
              </span>
            )}
            {source.funding_type && (
              <span className={\`inline-flex px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider border rounded-sm \${fundingBadgeClass(source.funding_type)}\`}>
                {source.funding_type}
              </span>
            )}
          </div>

          {source.parent_company && (
            <p className="text-[10px] text-muted-foreground mt-1.5 truncate">
              {source.parent_company}
            </p>
          )}
        </div>

        <MiniRadar scores={source.analysis_scores} />
      </div>

      {/* Analysis score bar */}
      {source.analysis_scores && Object.keys(source.analysis_scores).length > 0 && (
        <div className="mt-3 flex gap-1">
          {ANALYSIS_AXES.map((axis) => {
            const val = source.analysis_scores?.[axis];
            if (val == null) return null;
            return (
              <div key={axis} className="flex-1 text-center">
                <div className="text-[8px] font-mono text-muted-foreground uppercase tracking-wide">
                  {ANALYSIS_LABELS[axis]}
                </div>
                <div
                  className="text-[11px] font-mono font-medium"
                  style={{ color: \`hsl(\${(5 - val) * 24}, 70%, 55%)\` }}
                >
                  {val}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Index status indicator */}
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">
          {source.index_status === "complete" ? "indexed" : source.index_status ?? "unindexed"}
        </span>
        {avgScore != null && (
          <span
            className="text-[10px] font-mono font-medium"
            style={{ color: \`hsl(\${(5 - avgScore) * 24}, 70%, 55%)\` }}
          >
            avg {avgScore.toFixed(1)}
          </span>
        )}
      </div>
    </Link>
  );
}\`;

const newSourceCard = \`function SourceCard({ source }: { source: WikiSourceCard }) {
  const avgScore = useMemo(() => {
    if (!source.analysis_scores) return null;
    const vals = Object.values(source.analysis_scores);
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }, [source.analysis_scores]);

  return (
    <Link
      href={\`/wiki/source/\${encodeURIComponent(source.name)}\`}
      className="group block relative overflow-hidden bg-black/20 border border-white/5 transition-all duration-500 hover:bg-white/[0.03] hover:-translate-y-1 hover:shadow-2xl hover:shadow-primary/5 rounded-2xl p-4"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
      <div className="absolute h-px w-full top-0 left-0 bg-gradient-to-r from-transparent via-primary/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
      
      <div className="relative z-10 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            {source.country && (
              <span className="bg-white/10 text-white px-1.5 py-0.5 rounded-[4px] text-[10px]" title={source.country}>
                {countryCodeLabel(source.country)}
              </span>
            )}
            <h3 className="font-serif text-base lg:text-lg font-semibold text-foreground truncate group-hover:text-white">
              {source.name}
            </h3>
          </div>

          <div className="flex flex-wrap gap-1 mt-2">
            {source.bias_rating && (
              <span className={\`inline-flex px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider border rounded-sm \${biasBadgeClass(source.bias_rating)}\`}>
                {source.bias_rating}
              </span>
            )}
            {source.funding_type && (
              <span className={\`inline-flex px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider border rounded-sm \${fundingBadgeClass(source.funding_type)}\`}>
                {source.funding_type}
              </span>
            )}
          </div>

          {source.parent_company && (
            <p className="text-[10px] text-muted-foreground mt-1.5 truncate">
              {source.parent_company}
            </p>
          )}
        </div>

        <MiniRadar scores={source.analysis_scores} />
      </div>

      {/* Analysis score bar */}
      {source.analysis_scores && Object.keys(source.analysis_scores).length > 0 && (
        <div className="relative z-10 mt-3 flex gap-1">
          {ANALYSIS_AXES.map((axis) => {
            const val = source.analysis_scores?.[axis];
            if (val == null) return null;
            return (
              <div key={axis} className="flex-1 text-center">
                <div className="text-[8px] font-mono text-muted-foreground uppercase tracking-wide">
                  {ANALYSIS_LABELS[axis]}
                </div>
                <div
                  className="text-[11px] font-mono font-medium"
                  style={{ color: \`hsl(\${(5 - val) * 24}, 70%, 55%)\` }}
                >
                  {val}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Index status indicator */}
      <div className="relative z-10 mt-2 flex items-center justify-between">
        <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">
          {source.index_status === "complete" ? "indexed" : source.index_status ?? "unindexed"}
        </span>
        {avgScore != null && (
          <span
            className="text-[10px] font-mono font-medium"
            style={{ color: \`hsl(\${(5 - avgScore) * 24}, 70%, 55%)\` }}
          >
            avg {avgScore.toFixed(1)}
          </span>
        )}
      </div>
    </Link>
  );
}\`;

content = content.replace(oldSourceCard, newSourceCard);

content = content.replace(
  \`          <div className="text-xs text-muted-foreground font-mono space-y-1">
            <div className="flex justify-between">
              <span>Results</span>
              <span className="text-foreground">{filtered.length}</span>
            </div>
            <div className="flex justify-between">
              <span>Sources</span>
              <span className="text-foreground">{sources.length}</span>
            </div>
            <div className="flex justify-between">
              <span>Scored / Indexed</span>
              <span className="text-foreground">{scoredCount} / {indexedCount}</span>
            </div>
          </div>\`,
  \`          <div className="grid grid-cols-1 gap-2 text-xs text-muted-foreground font-mono">
            <div className="flex items-center justify-between bg-black/20 border border-white/5 rounded-lg p-2.5">
              <div className="flex items-center gap-2">
                <List className="w-3.5 h-3.5" />
                <span>Results</span>
              </div>
              <span className="text-foreground">{filtered.length}</span>
            </div>
            <div className="flex items-center justify-between bg-black/20 border border-white/5 rounded-lg p-2.5">
              <div className="flex items-center gap-2">
                <Database className="w-3.5 h-3.5" />
                <span>Sources</span>
              </div>
              <span className="text-foreground">{sources.length}</span>
            </div>
            <div className="flex items-center justify-between bg-black/20 border border-white/5 rounded-lg p-2.5">
              <div className="flex items-center gap-2">
                <Activity className="w-3.5 h-3.5" />
                <span>Scored / Indexed</span>
              </div>
              <span className="text-foreground">{scoredCount} / {indexedCount}</span>
            </div>
          </div>\`
);

content = content.replace(
  \`  return (
    <div className="bg-background text-foreground min-h-screen">
      <main className="mx-auto grid max-w-[1500px] gap-5 p-4 lg:grid-cols-[300px_minmax(0,1fr)]">\`,
  \`  return (
    <div className="bg-background text-foreground min-h-screen relative z-0">
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-background to-background z-[-1]" />
      <main className="mx-auto grid max-w-[1500px] gap-5 p-4 lg:grid-cols-[300px_minmax(0,1fr)]">\`
);

content = content.replace(
  \`          {/* Card grid */}
          {!loading && !error && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
              {filtered.map((source) => (
                <SourceCard key={source.name} source={source} />
              ))}
            </div>
          )}\`,
  \`          {/* Card grid */}
          {!loading && !error && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-5">
              {filtered.map((source) => (
                <SourceCard key={source.name} source={source} />
              ))}
            </div>
          )}\`
);

fs.writeFileSync(file, content);
console.log("Patched successfully!");
