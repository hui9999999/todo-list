# 小栖透明状态图集

内置 image_gen 生成，参考原角色设定。16 个姿态按 4 × 4 格排列，保留原始 PNG alpha。

最终素材经过内置 image_gen 编辑，输出 `exec-1a0479fc-8507-4d47-b156-2d3f026ecb8f.png`。编辑模式为本地图集参考、透明背景，清理文字和背景杂点并保留原姿态及排列。渲染时裁掉每格上方 10% 安全边距，避免上一格脚部进入下一格。

编辑提示词：

```text
Clean up this desktop pet sprite atlas for production. Preserve the exact 4 by 4 grid, every character pose, cream clay kitten shape, sage green checkmark scarf, leaf tail, props and their original cell positions. Only fix the corrupted transparency: completely REMOVE ALL disconnected white speckles, noisy flecks, colored fringe, ghost outlines, and background artifacts around the characters. Each sprite must be a pristine crisp isolated cutout. Every pixel outside the actual character and its attached prop must be fully transparent alpha zero, including all space between cells. No shadows, no background, no text or extra marks. Keep each sprite fully within its respective square cell with clean margins. Return the same 4 by 4 uniform atlas with genuine clean transparent background.
```

```text
Create a production-ready transparent PNG sprite atlas for the SAME 小栖 desktop-pet mascot shown in the reference, preserving its cream clay cat identity, short rounded ears, tiny cocoa eyes, peach cheeks and paw pads, sage neckerchief with cream checkmark, curved cream tail ending in one sage leaf. The reference sheet is identity guidance only: do not include its paper background or labels.
Output a SQUARE atlas on a genuinely transparent background, EXACTLY 4 columns by 4 rows of equally sized square cells, no gutters, NO TEXT, no labels, no grid lines, no headers, no checkerboard. Each cell contains exactly one full body pose centered horizontally with feet on the same baseline about 86 percent down that cell. All figures fit with at least 10 percent padding inside their own cells, including props, tails and raised paws. Character torso/head pixel size consistent across cells. Never let imagery cross a cell boundary. Soft matte 3D clay treatment, light delicate shading, no opaque ground plane or backdrop. Clean alpha edges; little to no floor shadow. High resolution 2048x2048 if possible.
Row 1 cells, left to right: 1 neutral standing smiling (idle), 2 side three-quarter walking with left foot forward, 3 side three-quarter walking with right foot forward (same character scale and direction as cell 2), 4 happy jogging.
Row 2: 5 cat reading tiny sage book (study focus), 6 cat typing on tiny cream keyboard (work focus), 7 thoughtful seated cat with paw to chin (AI thinking), 8 small happy airborne jump with paws raised (completed task celebration).
Row 3: 9 cat floating in the air with paws dangling and softly surprised expression (dragged), 10 cat softly compressed in four-paw landing pose, 11 front-paws-forward full body stretch, 12 seated yawning with one paw over mouth.
Row 4: 13 seated cat holding tiny sage water cup, 14 curled sleeping cat with leaf tail visible, 15 standing waving cat with one paw raised (reminder/interaction), 16 standing cat holding small sage umbrella (rainy weather).
Critical: sixteen cells, four rows and four columns, single consistent original character, absolutely no text or background, actual transparency. This is an asset atlas displayed by code using equal-cell coordinates; strict alignment matters. Do not make an art-direction board.
```
