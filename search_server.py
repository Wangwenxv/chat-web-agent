#!/usr/bin/env python3
"""将 search.py 包装成可供 GitHub Pages 前端调用的 HTTP 搜索服务。"""

import argparse
import asyncio
import time
from typing import Literal, Optional

import uvicorn
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from search import search_all


# 服务不携带 Cookie 或鉴权信息，允许静态站点及频繁变化的预览域名跨域读取结果。
app = FastAPI(title="Chat Web Agent Search", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["*"],
)


# 健康检查用于本地启动、Tunnel 连通性和部署探针，不触发外部搜索。
@app.get("/health")
async def health() -> dict:
    return {"ok": True, "service": "chat-web-agent-search"}


# 搜索接口限制输入长度和结果数量，并在线程中执行同步抓取以免阻塞 HTTP 服务。
@app.get("/api/search")
async def api_search(
    q: str = Query(min_length=1, max_length=300),
    engine: Literal["all", "baidu", "bing"] = "all",
    num: int = Query(default=8, ge=1, le=10),
    time_range: Optional[Literal["day", "week", "month", "year"]] = Query(
        default=None,
        alias="time",
    ),
) -> dict:
    query = q.strip()
    if not query:
        raise HTTPException(status_code=422, detail="q must contain visible characters")

    engines = ["baidu", "bing"] if engine == "all" else [engine]
    started = time.perf_counter()
    try:
        results = await asyncio.to_thread(
            search_all,
            query,
            engines,
            num,
            time_range,
        )
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"search failed: {error}") from error

    # 保持前端已有的搜索结果契约，同时返回实际命中的引擎和耗时便于排障。
    sources = list(
        dict.fromkeys(
            str(item.get("engine", ""))
            for item in results
            if item.get("engine")
        )
    )
    failures = [f"{name}: no results" for name in engines if name not in sources]
    return {
        "query": query,
        "total": len(results),
        "sources": sources,
        "failures": failures,
        "elapsedMs": round((time.perf_counter() - started) * 1000),
        "results": results,
    }


# 命令行入口默认只监听本机，由 cloudflared 主动连接，避免直接暴露局域网端口。
def main() -> None:
    parser = argparse.ArgumentParser(description="Chat Web Agent search HTTP server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
