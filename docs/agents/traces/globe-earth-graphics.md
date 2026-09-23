# Earth graphics verification

Goal: improve Earth terrain, water, atmosphere, and clouds without losing clickable
countries or increasing the rendering budget.

Implementation: packed normal XY and water mask, four managed textures instead of
five, two-lobe ocean highlights, subtle shader waves, limb atmosphere, and clouds
composited in the existing Earth pass. Removed the separate cloud sphere/material.
Country heat and selection remain above the surface; atmosphere raycasting is disabled.

Sources: Three.js r169 example normal/specular textures and MIT attribution are
recorded in `frontend/public/3dmodel/textures/optimized/ATTRIBUTION.md`. Existing
day/night textures remain. No live-weather claims or new dependencies.

Files: interactive-globe visual shaders, materials, types, config, scene setup;
two optimized textures and attribution; globe-materials regression test.

Runtime: clicked the United States in the in-app browser through the decorative
layers. The panel switched from Canada to United States and displayed 346 local
articles from 43 sources. No country dropdown was reintroduced.

Measurement: cached Chrome 152 headless with NVIDIA RTX 3060/ANGLE, 1280x900 CSS
viewport, 1208x836 drawing buffer, three samples of 180 requestAnimationFrame intervals.
Both compared scenes must have loaded article heat overlays. The first baseline
was rejected because it had zero articles; the upgraded scene had 8,002.
Corrected baseline: median 16.7 ms, p95 33.4 ms, 1,404 observed GL draws per frame.
A separate transparent cloud sphere regressed to 33.3 ms / 50 ms and was rejected.
The composited-cloud version is under verification.

Limits: a shared desktop and refresh-capped timings do not establish performance
on other devices or pure GPU time. Chrome MCP cannot attach (DevToolsActivePort
missing); direct CDP benchmark and in-app interaction checks are independent
evidence, not completion of the Chrome-MCP-only visual-verifier workflow.

Payload: 1,073,707 -> 912,921 bytes (15% reduction); four instead of five texture
samplers. Shader compilation and interaction are checked separately from unit tests.

Rollback: revert only these graphics hunks and new assets, preserving the GeoJSON
country discriminator fix and unrelated worktree changes.
