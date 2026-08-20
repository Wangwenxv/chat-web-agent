D:\aiops_wwx\test\chat-web-agent\
├── .agents\skills\cwui-enterprise-components\SKILL.md   # Agent 技能文件
├── .cwui-knowledge.json                                 # CWUI 知识配置
├── package.json / vite.config.ts / tsconfig.json
├── index.html
└── src\
    ├── main.tsx                    # React 入口（createRoot）
    ├── App.tsx                     # 根组件（540 行，含全部业务逻辑）
    ├── types.ts                    # 全部 TS 类型定义
    ├── styles.css                  # 全局样式（无组件库，手写 CSS）
    ├── agent\                      # Agent 核心逻辑
    │   ├── runner.ts               # runUserTurn 回合执行器
    │   ├── prompt.ts               # buildSystemPrompt 系统提示词
    │   ├── policies.ts             # 发布前检查
    │   └── title.ts                # 会话标题生成
    ├── components\
    │   ├── chat\Composer.tsx       # 消息输入框
    │   ├── chat\MessageView.tsx     # 消息渲染
    │   ├── chat\SessionList.tsx     # 会话列表
    │   ├── settings\SettingsModal.tsx  # Agent 设置弹窗
    │   ├── workspace\Sidebar.tsx    # 侧栏
    │   └── inspector\               # 预览/源码/问题/差异面板
    ├── model\client.ts              # 模型 API 客户端（fetch + SSE）
    ├── tools\registry.ts            # 工具定义与执行
    ├── workspace\repository.ts      # IndexedDB 数据层
    ├── preview\build.ts             # 预览构建
    ├── export\zip.ts                # ZIP 导入导出
    ├── search\providers.ts          # 网页搜索
    └── lib\                         # segment/diff/path 工具