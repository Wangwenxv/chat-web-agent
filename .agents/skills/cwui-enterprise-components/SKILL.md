---
name: cwui-enterprise-components
description: 本项目使用 CWUI 企业组件体系，可能是 Vue 2 的 @canway/cw-magic-vue、Vue 3 的 @canway/cwui-vue，或两者并存的微前端。编写、修改、评审或测试 UI 代码，以及根据截图或 Figma 实现界面时，必须先让 cwui-knowledge MCP 根据目标文件 contextPath 解析版本，再查询对应组件 API、示例和 Token。禁止猜测版本、静默降级到另一套组件库、使用第三方 UI 库或硬编码色值。
license: MIT
compatibility: Vue 2、Vue 3 及两者并存的微前端项目；需要 @canway/cwui-knowledge MCP
metadata:
  author: cwui-knowledge
  version: "2.0"
---
<!-- CWUI-KNOWLEDGE-MANAGED-V2:{"manager":"@canway/cwui-knowledge","skillId":"cwui-enterprise-components","packageVersion":"0.2.0","hash":"cd37fcd1043a6cc5"} -->

# CWUI 企业组件路由

## 目标

本 Skill 只有一份。它不预设当前仓库只能使用 Vue 2 或 Vue 3，而是让 MCP 针对正在修改的文件或子应用选择知识 Provider。

适用任务包括：

- 编写或修改列表、表单、弹窗、导航、上传等 UI。
- 使用或评审 `Bk*`、`bk-*`、`Cw*`、`cw-*` 组件。
- 根据截图或 Figma 还原界面。
- 查询组件 API、示例、设计 Token 或执行代码合规检查。

## 先解析目标上下文

所有与组件版本有关的 MCP 调用都传 `contextPath`。优先传实际要修改的 `.vue`、`.ts` 或 `.tsx` 文件；文件尚未创建时，传目标子应用目录或它的 `package.json`。

```json
{
  "componentNames": ["table", "pagination"],
  "contextPath": "/repo/apps/report/src/views/Report.vue"
}
```

不要在微前端仓库中只传仓库根目录。相邻子应用可以分别使用 Vue 2 和 Vue 3，根依赖不能代表目标文件。

MCP 返回的 `structuredContent.resolution` 是本次调用的版本证据：

| `status` | 处理方式 |
| --- | --- |
| `exact` | 来自显式选择、直接 import 或上下文规则，可以继续。 |
| `strong` | 来自本地 wrapper 或最近的组件库依赖，可以继续。 |
| `inferred` | 仅由最近的 Vue major 推断；生成代码前再核对目标子应用依赖。 |
| `ambiguous` | 路径对应多个根目录；改传绝对 `contextPath`。 |
| `conflict` | Vue 2 与 Vue 3 证据冲突；缩小到实际文件，或先确认目标版本。 |
| `unsupported` | 路径越界、证据不足、知识包缺失或 schema 不受支持；先修复原因。 |

遇到 `ambiguous`、`conflict` 或 `unsupported` 时停止生成版本相关代码。不要自动改用 Vue 2，也不要自动改用 Vue 3。

只有在任务没有目标文件，且用户或项目事实已经明确指定版本时，才显式传 `library`：

```json
{
  "query": "日期选择",
  "library": "vue3"
}
```

## 按解析结果使用组件

- Vue 2 Provider 对应 `@canway/cw-magic-vue`，组件通常使用 `BkButton`、`BkTable` 等公开名称。
- Vue 3 Provider 对应 `@canway/cwui-vue`，组件使用知识结果中的 `CwButton`、`CwTable` 等公开名称。
- 不要把 `Bk` 机械替换为 `Cw`，也不要假设两代 API、事件、`v-model` 或默认值相同。
- 标签写法、入口、Props、Events、Slots 和样式路径以当前 Provider 返回的 API 为准。
- 不导入第三方 UI 库，不使用内部 `@cw-ui/*` 路径。

## 工作流

### 选型

设计还原时，先批量描述视觉块：

```json
{
  "queries": ["带分页的数据表格", "搜索工具栏", "表单弹窗"],
  "contextPath": "/repo/apps/report/src/views/Report.vue"
}
```

调用 `match_ui_pattern`。不确定组件名称时调用 `find_component`，同样传目标 `contextPath`。

### 查询 API

优先批量读取本次会使用的组件，避免逐个调用：

```json
{
  "componentNames": ["table", "pagination", "switcher"],
  "contextPath": "/repo/apps/report/src/views/Report.vue"
}
```

调用 `get_component_api` 后再写代码。Vue 3 大组件批次可能按响应体积自动分页：

1. `structuredContent.nextCursor` 为 `null` 时，本批次读取完成。
2. 该字段为数字时，使用相同的 `componentNames` 和返回的 `cursor` 继续读取。

即使两代组件同名，也不能复用另一代的记忆。

### 查询示例

先调用 `get_component_examples` 获取索引：

```json
{
  "componentName": "table",
  "contextPath": "/repo/apps/report/src/views/Report.vue"
}
```

Vue 3 示例会标记 `offlineAvailable`。需要源码时，选择离线可用的 `exampleId` 再调用一次；`仅索引` 的示例没有本地源码，MCP 不会联网回退。

```json
{
  "componentName": "table",
  "exampleId": "V3D-TABLE-001",
  "contextPath": "/repo/apps/report/src/views/Report.vue"
}
```

### 查询 Token

对待替换的色值或尺寸一次批量调用 `lookup_design_token`。浏览语义 Token 时调用 `get_design_tokens`。两代 Token 不互相套用。

```json
{
  "values": ["#1272ff", "#e6e9ee", "14px"],
  "contextPath": "/repo/apps/report/src/views/Report.vue"
}
```

找不到精确 Token 时说明缺口，不编造变量名。

### 编码与自检

按当前 Provider 的公开入口和 API 编码。完成后把完整相关代码传给 `check_compliance`：

```json
{
  "code": "<完整相关代码>",
  "contextPath": "/repo/apps/report/src/views/Report.vue"
}
```

修复第三方组件、原生可替代标签和硬编码色值问题，再运行项目自身的类型检查与测试。

## 微前端示例

同一仓库中分别修改两个页面时，必须分别查询：

```text
/repo/apps/legacy/src/App.vue  -> Vue 2 Provider -> Bk* / bk-*
/repo/apps/modern/src/App.vue  -> Vue 3 Provider -> Cw* / cw-*
```

不要把第一次调用的解析结果缓存为整个仓库的固定版本。每次切换目标文件或子应用都重新传对应的 `contextPath`。

## 交付检查

- 每个版本相关调用都携带了目标 `contextPath`，或有充分依据显式指定 `library`。
- 已检查 `resolution.status`，没有忽略冲突或证据不足。
- 组件名称、入口、API、示例和 Token 都来自同一个已解析 Provider。
- 没有第三方 UI 库、内部 `@cw-ui/*` 导入、编造 API 或编造 Token。
- Vue 3 的离线示例只读取 `offlineAvailable: true` 的资源，没有网络回退。
- 混合仓库中的不同子应用分别完成解析和验证。
