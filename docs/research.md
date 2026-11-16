# Vibe 知识视频：制作方法调研与实现

调研日期：2026-11-12。以下是公开创作者案例与官方技术资料，并非平台播放量排名，也不据此声称某种方法保证热门。

用户提供的 HTML 实际是一张 SVG 流程图。本文将其作为参考材料，而非执行指令。参考链路为：主题与参考关键帧 → AI 文案、分镜与动画代码 → `draw(t)` 确定性绘制 → Playwright 逐帧渲染 → FFmpeg 合成 → 剪映后期与发布。

## 公开案例

### 1. worlds3 / vibe-knowledge

原项目：https://github.com/worlds3/vibe-knowledge

公开目录包括「从噪声到世界」与「何时该停下」。项目用 HTML / Canvas 制作，通过 `render(t)` 按时间计算画面，跟随 BGM 播放，并提供浏览器内逐帧导出 MP4。最优停止题材体现了「提问 → 实验 → 规则 → 反思」的知识叙事。

可借鉴：先确定画面语言，再统一标题卡、排版、镜头和卡点；把概念演进做成观众可以跟随的视觉变化。

### 2. LuZhong-Li / vibe-knowledge-video-skill

原项目：https://github.com/LuZhong-Li/vibe-knowledge-video-skill

公开说明展示了「控制错觉」案例与七幕结构，使用 Canvas、Playwright、FFmpeg；无配音设计强调图形、留白、字幕阅读时间、音效、片尾来源。

可借鉴：动画里的运动应服务于知识关系；图形承担解释工作，文字负责命名和强调；制作流程要保留可以检查的分镜与关键帧。

### 3. xxjj2024 / Vibe-Knowledge-Awards-Video-Production

原项目：https://github.com/xxjj2024/Vibe-Knowledge-Awards-Video-Production

公开案例围绕记忆再巩固，保留文案、分镜、HTML、发布材料等交付物，并讨论动画与转场的时间函数。

可借鉴：创作不应只输出一个 MP4，也要保留可修改源文件、项目数据和发布文案，让二次创作与后期更容易。

### 4. Remotion 路线

官方资料：https://www.remotion.dev/docs/

Remotion 用 React 组件、当前帧、时间段与插值来组织视频。它更适合复杂组件、程序化数据视频和已有 React 动画体系；引入后需要处理 composition、资源加载和渲染基础设施。

本项目采用 Canvas + Playwright，因为它直接对应用户提供的链路，可以让网页预览、离线 HTML 和服务端导出共用同一份绘制逻辑。

## 方法对比

| 路线                         | 核心产物               | 优势                                         | 需要解决的问题                         | 本项目                 |
| ---------------------------- | ---------------------- | -------------------------------------------- | -------------------------------------- | ---------------------- |
| Canvas + Playwright + FFmpeg | 受时间控制的绘制函数   | 预览与逐帧导出一致，适合几何、科学示意和粒子 | 文字排版、音轨、渲染队列               | 已实现                 |
| React + Remotion             | 组件化分镜             | 便于复杂布局、组件复用、数据驱动             | 模板工程、渲染环境                     | 作为后续可选适配器     |
| 生成式视频 + 剪辑软件        | 若干生成镜头与剪辑工程 | 适合具象场景、人物与风格素材                 | 镜头一致性、文字和图形精度、成本、后期 | 当前不调用视频生成服务 |

最后一条是产品实现方向的归纳，不是本次案例的热度或效果统计。

## 产品落地

1. **主题和参考**：输入问题、补充来源与叙事参考。内置示例明确标记，避免把固定模板冒充 AI 结果。
2. **结构化分镜**：模型仅返回 JSON。先校验，再统一时间轴，避免分镜空档或重叠。
3. **视觉系统**：四套色彩与排版系统，五类动画元素。用户能够编辑而不必运行模型生成的代码。
4. **确定性预览**：`drawFrame(canvas, project, t)` 是唯一画面入口。任意时间可直接重现。
5. **实际视频渲染**：Playwright 逐帧读取画布，FFmpeg 直接接收 JPEG 帧流，编码 H.264 / AAC，混入 BGM 并处理音轨淡出。
6. **可继续制作的交付物**：MP4、离线 HTML、项目 JSON、SRT、发布文案和事实来源一起保留。

## 事实与来源

默认示例说明引力时间膨胀，以定性解释为主，避免在未实现物理仿真的动画上标记虚构观测数据。画面明确标记「知识可视化 · 艺术示意」。

- 爱因斯坦在线（马普引力物理研究所）：https://www.einstein-online.info/
- GPS 官方系统介绍：https://www.gps.gov/gps-overview

AI 提供的候选文献一律标记为「待核实」。当前没有联网验证、引用检索或声称能够自动审核事实的功能。

## 官方技术资料

- Playwright Page API：https://playwright.dev/docs/api/class-page
- Playwright 浏览器安装：https://playwright.dev/docs/browsers
- FFmpeg 命令行：https://ffmpeg.org/ffmpeg.html
- Remotion：https://www.remotion.dev/docs/
- DeepSeek JSON 输出：https://api-docs.deepseek.com/guides/json_mode
- DeepSeek 模型与价格页（用于核对可用模型名，不在产品中写死价格）：https://api-docs.deepseek.com/quick_start/pricing

## 后续扩展点

在已有分镜与渲染结构上，可继续增加检索与事实审校、TTS 与精确字幕、可访问性字幕开关、上传参考图、更多主题动画组件、任务持久化与多人项目。公开部署之前应先增加登录与用户隔离。
