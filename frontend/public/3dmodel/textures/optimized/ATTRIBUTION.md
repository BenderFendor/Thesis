# Earth surface maps

`earth-normal-water-2048.webp` combines the R/G tangent-space normal channels of
`earth_normal_2048.jpg` and the red water/specular channel of
`earth_specular_2048.jpg`, from the Three.js r169 example texture collection:

- https://github.com/mrdoob/three.js/tree/r169/examples/textures/planets
- https://raw.githubusercontent.com/mrdoob/three.js/r169/examples/textures/planets/earth_normal_2048.jpg
- https://raw.githubusercontent.com/mrdoob/three.js/r169/examples/textures/planets/earth_specular_2048.jpg

The maps retain the upstream 2048×1024 equirectangular projection. Packed RGB stores
normal X, normal Y, and water reflectivity, respectively; the shader uses XY to
perturb and normalize the surface normal. WebP quality 85, effort 6. This is linear
data, not an sRGB color texture.

`earth-cloud-density-2048.webp` is a quality-70 WebP re-encoding of this project's
existing `clouds-earth-2048.webp`. Existing day/night imagery remains unchanged.
Cloud motion is illustrative, not live weather.

## Three.js license

The MIT License

Copyright © 2010-2024 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
