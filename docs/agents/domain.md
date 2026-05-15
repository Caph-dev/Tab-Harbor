# Domain Docs

工程类技能在探索代码库前，应按此文件读取本仓库的领域文档。

## 探索前先读取

- 根目录的 `CONTEXT.md`
- 如果根目录存在 `CONTEXT-MAP.md`，它会指向每个 context 对应的 `CONTEXT.md`；读取与当前任务相关的部分
- `docs/adr/` 中与当前工作区域相关的 ADRs
- multi-context 仓库还需要检查 `src/<context>/docs/adr/` 中的 context-scoped decisions

如果这些文件或目录不存在，静默继续。不要因为缺失而报错，也不要预先建议创建它们。生产文档的技能，例如 `/grill-with-docs`，会在术语或决策真正被明确后按需创建。

## 文件结构

本仓库使用 single-context 布局：

```text
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-example-decision.md
│   └── 0002-example-decision.md
└── extension/
```

multi-context 仓库通常以根目录的 `CONTEXT-MAP.md` 作为信号：

```text
/
├── CONTEXT-MAP.md
├── docs/adr/
└── src/
    ├── frontend/
    │   ├── CONTEXT.md
    │   └── docs/adr/
    └── backend/
        ├── CONTEXT.md
        └── docs/adr/
```

## 使用 glossary 中的词汇

当输出中需要命名领域概念时，例如 issue 标题、重构建议、假设或测试名，使用 `CONTEXT.md` 中定义的术语。不要漂移到 glossary 明确避免的同义词。

如果需要的概念还不在 glossary 中，这是一个信号：要么正在发明项目并未使用的语言，需要重新考虑；要么确实存在文档缺口，可以留给 `/grill-with-docs` 处理。

## 标出 ADR 冲突

如果输出与现有 ADR 冲突，需要明确说明，而不是静默覆盖：

```text
Contradicts ADR-0007 (event-sourced orders), but worth reopening because...
```
