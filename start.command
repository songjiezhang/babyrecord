#!/bin/sh

set -eu

CODEX_NODE="/Users/sjzhang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
EXPO_CLI="$(dirname "$0")/node_modules/expo/bin/cli"

if [ ! -x "$CODEX_NODE" ]; then
  echo "未找到 Codex 自带的 Node.js。请先从 https://nodejs.org 安装 Node.js。"
  exit 1
fi

if [ ! -f "$EXPO_CLI" ]; then
  echo "项目依赖尚未安装，请先安装 Node.js 和 pnpm 后运行 pnpm install。"
  exit 1
fi

exec "$CODEX_NODE" "$EXPO_CLI" start --clear
