# Contributing

感谢你愿意改进 Vibe Studio。这个项目优先保证「本机可复现」和「画面确定性」，提交前请先看下面的约定。

## 开发环境

需要 Node.js 22.12+、Chrome / Chromium 和 FFmpeg。

```bash
npm install
npm run dev       # http://localhost:3000
npm run check     # 类型检查
npm test          # 单元 / 集成测试
```

修改了 `shared/renderer.mjs`、`server/` 或 `src/` 后，至少跑一遍：

```bash
npm run check
npm test
npm run format:check
```

浏览器端到端测试需要先启动开发服务器：

```bash
npm run test:ui
npm run test:ai-ui
```

## 提交约定

- 先开 issue 描述问题和期望行为，较大的改动先讨论方案。
- 一个 PR 只做一件事，附上复现步骤、改动原因和验证命令。
- 修复画面问题请附上修改前后的关键帧截图。
- 不要提交 `.env`、`.data/`、`test-results/` 或任何真实 API Key。
- 代码风格交给 Prettier：`npm run format`。

## 设计原则

1. **确定性**：`drawFrame(canvas, project, t)` 不能依赖随机数、上一帧或全局可变状态。预览、离线 HTML、MP4 必须一致。
2. **模型只产出数据**：不要让模型输出可执行代码；新字段先加 schema 校验。
3. **本地优先**：不要默认引入云服务、账号体系或遥测。
4. **不编造数据**：没有可靠来源的数值，宁可不显示。
5. **可编辑的交付物**：新增导出格式时，优先考虑能否二次修改。

## 重新生成 README 素材

```bash
npm run dev
npm run docs:capture
```

截图与动图会写入 `docs/screenshots/`。脚本只读取页面，不会修改 `.data/`。
