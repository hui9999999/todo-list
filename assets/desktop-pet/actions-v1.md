# 小栖 · 动作扩展 v1

沿用原设定的奶油色小猫、鼠尾草绿围巾、勾选徽记和叶片尾巴。本轮为 12 个静态动作设计，供后续制作动画参考；图片没有接入应用运行逻辑。

生成方式：内置 image_gen 工具，以 xiaoqi-concept.png 为角色身份参考。

## 动作及触发建议

| 动作 | 画面设计 | 应用中的触发建议 |
| --- | --- | --- |
| 走路 | 轻快迈步，尾巴随步伐摆动 | 空闲时在允许区域内缓慢移动 |
| 小跑 | 身体前倾、抬起脚掌 | 用户召唤时移动到指定位置 |
| 伸懒腰 | 前爪伸展，身体拉长 | 从休息状态恢复 |
| 打哈欠 | 坐下，爪子掩住嘴巴 | 长时间闲置或深夜时段 |
| 喝水 | 双爪抱小杯子 | 番茄钟休息时的轻提示 |
| 思考 | 歪头，爪子托下巴 | AI 正在处理消息时 |
| 打字 | 小爪子敲键盘 | 工作分类任务专注时 |
| 整理清单 | 在清单卡片上打勾 | 创建任务或整理今日安排后 |
| 拖拽 | 身体悬空，小爪自然垂下 | 用户拖动桌宠时 |
| 落地 | 身体轻轻压缩，四爪着地 | 松开拖拽后 |
| 探头 | 歪头观察，前爪搭在边缘 | 鼠标接近桌宠或打开任务详情时 |
| 撑伞 | 举起绿色小伞 | 天气信息显示有雨时 |

建议用“走路 → 停下 → 思考”“拖拽 → 落地 → 伸懒腰”“工作打字 → 休息喝水 → 恢复专注”等短组合，使状态切换自然。提醒宜轻柔、可关闭，专注期间保持低干扰。

## 完整生成提示词

```text
Use case: stylized-concept / character identity preservation.
Reference image: the attached existing 小栖 character concept sheet is the authoritative identity and material reference. Use it to create ONE NEW expanded action-design sheet, not an alteration of the old layout and not a new character.
Preserve EXACTLY the same cream colored rounded cat, head/body proportions, short rounded triangular ears with peach interiors, small cocoa eyes and expressive brows, tiny cocoa nose/mouth, soft peach cheek blush, sage green neckerchief with cream checkmark, short cream curved tail ending in one sage green leaf, rounded paws with peach pads, matte soft clay figurine appearance. No extra body markings, hats, costume changes, extra tails, extra limbs, or fur. Keep a consistent character across all twelve cells. Adult-friendly gentle companionship for a productivity desktop application. Clear silhouettes readable at small desktop sizes.
Composition: a polished large square art-direction board on plain warm ivory paper background, twelve evenly spaced cells in a precise 4-column x 3-row grid, generous outer margins and breathing room. One fully visible character per cell; all characters have the same visual scale and proportion, props stay inside their own cell, all tails and ears visible. Small understated grounding shadows. Header at top reads exactly “小栖 · 动作扩展”. The only other text is the matching Chinese label centered beneath each action. No descriptive copy, no English words, no numbered stickers. Subtle cocoa Chinese typography. Do not include the four previous states reading/reminder/celebration/sleeping.
Row 1, left to right:
“走路”: cat in an unmistakable side three-quarter walking step, one small foot forwards, relaxed swinging forepaws, leaf tail gently following.
“小跑”: brisk happy jogging pose, body leaning forwards, two bent forepaws, one foot lifted, a couple small tasteful motion strokes.
“伸懒腰”: waking stretch, forepaws extended forward on ground, rounded back lengthened with rump gently raised, eyes contentedly closed, leaf tail curled upwards.
“打哈欠”: seated with one paw covering an open yawning mouth, sleepy half closed eyes, no tears.
Row 2:
“喝水”: seated holding a tiny sage-green cup with both paws close to mouth, relaxed expression.
“思考”: seated with one paw at chin, tilted head, slightly raised eyebrow, looking upward thoughtfully; no question marks.
“打字”: seated behind a tiny simple low profile cream keyboard, both rounded paws typing, attentive expression, no laptop or monitor.
“整理清单”: holding a small cream task-list card with only a few sage checkmarks, other paw marking the next check with a short pencil.
Row 3:
“拖拽”: full body lifted and suspended gently in midair, four little paws dangling, softly surprised face, leaf tail hanging naturally, no visible hand, no strings, no cursor. A faint shadow well below implies elevation. Never neck grabbing.
“落地”: a gentle landing pose, four paws touching the ground, compact slightly squashed rounded body, attentive eyes, ears and tail bounce subtly, two tiny motion strokes.
“探头”: inquisitive leaning sideways with head tilted and one paw lightly resting on a very short minimal rounded edge line, body and leaf tail fully visible, curious eyes. No actual UI panel.
“撑伞”: standing holding a small sage-green umbrella above head, a few minimal peach raindrop marks outside the canopy, calm cheerful expression, neckerchief and leaf tail visible.
Style: same soft matte 3D clay illustration as the reference, warm cream, sage, cocoa, muted peach. Clean professional mascot turnaround quality. Avoid generic emoji style, plush fur, shiny plastic, photorealism, harsh shadows, busy background, huge anime eyes, inconsistent accessories, cropped poses, duplicated states, extra characters, watermarks, software UI. This is a static action concept board, not an animation-frame atlas.
```

