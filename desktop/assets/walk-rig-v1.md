# 小栖连续步态修正

内置 `image_gen`，本地 `xiaoqi-motion-v3.png` 作为角色参考，透明背景。原始 PNG 保留，项目素材 `xiaoqi-walk-rig-v1.png`。输出 `exec-caa447bc-69d9-45f8-9bd8-1b85cd645bf1.png`。

旧步行素材由独立姿态组成，身体细节、头部位置不一致，重复帧造成停顿。步行改用同一身体和两条独立腿，由 Canvas 连续绘制，旧图集保留用于其他动作及中间态。分件先按正常遮挡合成，再进行状态过渡，避免连接处颜色叠加发白。

桌面移动速度为 25 DIP/秒。步幅随 120/160/200 尺寸缩放，周期同时为 600/800/1000ms，使支撑脚相对身体以 -25 DIP/秒移动，另一只脚轻微抬起前移；接触点位置及速度连续。主进程发布步行起点，准备姿态结束后移动，渲染与位移使用同一时钟。漫步时悬停不打断步态，庆祝会停下漫步，触及屏幕边缘转身。

生成提示词：

```text
Create an animation RIG PARTS sheet of the same cream clay kitten in the reference: cocoa oval eyes, peach cheeks, sage green triangular scarf with cream checkmark, cream tail ending sage leaf, matte handmade clay 3D. Transparent RGBA. Horizontal sheet of EXACTLY THREE equal square cells, 3 columns 1 row. Each cell is a separate clean cutout animation component, NOT three full cats. NO text, labels, ground shadows, background or speckles. First cell: kitten's complete HEAD, BODY, ARMS and leaf TAIL, looking three-quarter slightly right, smiling softly. NO LEGS and NO FEET. Its rounded cream abdomen ends in a smooth oval at bottom so two separate legs can be attached underneath by code. Keep head and body intact, gentle standing upright proportions, arms relaxed beside body, tail visible left. Clear padding 15 percent around the whole component. Second cell: ONLY ONE cream cat LEG AND PAW component, a short vertical rounded matte cream capsule, slightly tapering upper shin ending in a wider soft round paw at bottom. Front-three-quarter-right standing angle. No pink sole visible (sole faces the ground), no claws. One independent limb with alpha all around it, centered and occupying 35 percent cell height and 18 percent cell width. Third cell: ONLY the OTHER leg and paw, matching second in size, material and lighting, slightly mirrored shading for the opposite leg, same front-three-quarter-right view. Both isolated legs should have rounded tops so they rotate at hips behind the abdomen. No extra body parts, no torso in cells 2 or 3. The first cell MUST have no legs; the other cells each MUST have exactly one individual leg. High quality consistent soft clay shading and silhouette, crisp transparent alpha.
```
