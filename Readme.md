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

## 通用联网搜索

前端默认继续使用 GitHub、Stack Overflow、Hacker News 和 npm 的纯前端搜索链路。需要搜索新闻、公司、人物等非代码信息时，可以启动本地 Python 服务并通过 Cloudflare Quick Tunnel 暴露 HTTPS 地址。

```powershell
python -m pip install -r requirements.txt
python search_server.py --host 127.0.0.1 --port 8765
```

保持搜索服务运行，在另一个 PowerShell 窗口启动 Tunnel：

```powershell
& 'C:\Program Files (x86)\cloudflared\cloudflared.exe' tunnel --url http://127.0.0.1:8765 --no-autoupdate
```

打开“Agent 设置”，勾选“启用通用联网搜索”，填写命令输出的 `https://*.trycloudflare.com` 地址并保存。Quick Tunnel 每次启动都可能生成新域名，因此前端不会将域名写死在构建产物中。

开启后 Agent 会按问题类型选择工具：

- `developer_search`：代码、仓库、包和开发者社区资料。
- `web_search`：新闻、公司、人物、产品、政策和其他通用网页资料。

健康检查地址为 `/health`，搜索接口为 `/api/search?q=关键词&engine=all&num=8`。
