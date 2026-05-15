# Issue tracker: GitHub

本仓库的 issues 和 PRDs 存放在 GitHub Issues 中。所有相关操作默认使用 `gh` CLI。

## 约定

- **创建 issue**：`gh issue create --title "..." --body "..."`。多行正文优先使用 heredoc。
- **读取 issue**：`gh issue view <number> --comments`，需要时同时获取 labels，并用 `jq` 过滤 comments。
- **列出 issues**：`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，按需要添加 `--label` 和 `--state` 过滤。
- **评论 issue**：`gh issue comment <number> --body "..."`
- **添加或移除 labels**：`gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **关闭 issue**：`gh issue close <number> --comment "..."`

在 clone 内运行时，`gh` 会根据 `git remote -v` 自动推断仓库。

## 当技能要求 “publish to the issue tracker”

创建一个 GitHub issue。

## 当技能要求 “fetch the relevant ticket”

运行 `gh issue view <number> --comments`。
