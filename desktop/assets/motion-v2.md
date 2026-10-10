# 小栖步态与动作过渡

2026-10-03，内置 `image_gen`，本地角色图集参考生成，再通过内置编辑修正左右脚换位，`transparent_background: true`。保留原始 PNG 和 alpha；最终素材 `xiaoqi-motion-v3.png`，第一版 `xiaoqi-motion-v2.png` 保留，旧图集继续用于学习、工作等有道具的动作。

源输出：`exec-01bc9d45-a094-4134-a93f-6dae03cb00c5.png`；最终编辑输出：`exec-52ddfeb2-13c7-49a7-bed4-bcaf9aeecc56.png`。

步态使用索引 0–5，按 `[0,1,2,3,4,5,5,0]` 八个节拍播放，800ms 一轮，每轮一次左脚和一次右脚前伸。两个停留节拍用于落脚和下一轮抬脚；弃用重复右腿抬起的 6、7 格。朝向随移动方向镜像。
索引 8–15：站立、收势、起身、坐下、下蹲、起跳、提起、落地。普通切换约 215ms；拖动提起 65ms，窗口位移立即响应；庆祝先下蹲起跳，然后落地。

原图格子边距不完全一致，因此 `frame-bounds.json` 保存只读 alpha 连通区域分析得到的每帧源坐标，运行时按固定比例和头部/脚底锚点绘制完整角色。没有修改 PNG。悬浮窗口与绘制区域保持用户所选的 120/160/200 尺寸。

左右脚修正的完整编辑提示词：

```text
EDIT this exact transparent 4x4 kitten sprite sheet. Keep BOTTOM TWO ROWS (eight intermediate action poses) unchanged. Replace ONLY TOP TWO ROWS with an unmistakably alternating TWO-LEG walk cycle. The cat is viewed ALMOST FRONTALLY, slightly looking to viewer's right. This frontal view is essential so both legs remain visibly separate, NEVER crossed or merged. One leg is ALWAYS on VIEWER'S LEFT of body, the other ALWAYS on VIEWER'S RIGHT. LEFT paw is centered at 43 percent cell width, RIGHT paw at 61 percent cell width. Both feet must be clearly visible in ALL eight cells, one raised and one planted. Cream clay cat, sage check scarf and leaf tail identity unchanged. Top row: cell 0 VIEWER-LEFT foot raised HIGH FORWARD with pink sole showing, VIEWER-RIGHT foot firmly flat on ground; cell 1 VIEWER-LEFT foot lowered halfway forward (sole still visible), VIEWER-RIGHT foot planted; cell 2 LEFT foot fully planted on ground, RIGHT foot begins lifting back; cell 3 LEFT foot planted, RIGHT foot raised halfway forward showing sole. SECOND row: cell 4 VIEWER-RIGHT foot raised HIGH FORWARD with pink sole showing, VIEWER-LEFT foot firmly flat on ground; cell 5 VIEWER-RIGHT foot lowered halfway forward sole visible, VIEWER-LEFT planted; cell 6 RIGHT foot fully planted, LEFT foot begins lifting back; cell 7 RIGHT foot planted, LEFT foot raised halfway forward sole showing. Frames 0 and 4 MUST be visually obvious opposites with raised pink foot on LEFT then RIGHT. Feet must not all extend on viewer's right. Keep head/body exact same size and baseline, soft minimal bob only. All characters fully inside cells with 10 percent margin; no texts, no white or colored noise around sprites, fully clean transparent alpha. Do not redraw bottom two rows.
```


生成与编辑提示词：

```text
Create a production animation sprite sheet of the SAME cream clay kitten shown in the reference: cocoa oval eyes, peach cheeks and pink paw pads, tiny ears, sage green triangular neckerchief with a cream check mark, cream curved tail with sage leaf tip. Transparent RGBA background. Exactly 4 columns by 4 rows, 16 equal square cells, NO borders, labels or shadows. Character completely inside each cell with 12 percent clear padding on ALL sides. Uniform head size and camera, head width approx 40 percent of cell, grounded feet at same 84 percent cell height. Rows 1 and 2 are an EIGHT FRAME WALK CYCLE, same three-quarter view facing RIGHT, with truly ALTERNATING LEFT AND RIGHT FEET (not repeated poses). Read row-major: 0 LEFT foot forward contact and RIGHT foot back; 1 LEFT foot planted, RIGHT heel lifted behind; 2 RIGHT foot lifted passing planted LEFT leg; 3 RIGHT foot reaching forward, LEFT pushing off behind; 4 RIGHT foot forward contact and LEFT foot back; 5 RIGHT foot planted, LEFT heel lifted behind; 6 LEFT foot lifted passing planted RIGHT leg; 7 LEFT foot reaching forward, RIGHT pushing off behind. Visibly opposite forward feet in frames 0 and 4. Slow gentle short steps, alternate arm swing, no props in walking frames. Rows 3 and 4 are genuine intermediate animation poses, front three-quarter view: 8 relaxed neutral standing, paws down; 9 half raising arms at chest, knees slightly bent; 10 halfway rising from seated to standing, bent knees; 11 halfway sitting down, eyes half closed; 12 deep crouch before joyful jump; 13 rising midway through jump, feet suspended slightly, paws lifting; 14 being lifted midway, arms up and feet gently dangling; 15 soft landing squat, both feet on ground and knees bent. Same identity, neckerchief and tail in EVERY frame. Rounded handmade matte clay 3D style, soft studio lighting, clean alpha edges. Each frame is a single whole kitten, no extra feet, no ghosting, no separate props. Output square sprite atlas.
```
