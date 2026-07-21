#!/bin/sh
# go-proxy 容器入口脚本
#
# 设计目标：让配置文件持久化在宿主机，跨镜像更新不丢失。
#   - 镜像只内置一份「默认配置」(/app/config.default.yaml)，作为兜底与初始化模板。
#   - 运行时配置实际位于挂载目录内的 config.yaml（默认 /app/config.d/config.yaml）。
#   - 首次启动若发现配置文件不存在（如刚 pull 新镜像、宿主机还没有配置），
#     自动从内置默认配置复制一份过去，容器即可正常启动，且后续修改持久化在宿主机。
set -e

CONFIG_FILE="${1:-/app/config.d/config.yaml}"
CONFIG_DIR=$(dirname "$CONFIG_FILE")
DEFAULT_CONFIG="/app/config.default.yaml"

if [ ! -f "$CONFIG_FILE" ]; then
  mkdir -p "$CONFIG_DIR"
  if [ -f "$DEFAULT_CONFIG" ]; then
    cp "$DEFAULT_CONFIG" "$CONFIG_FILE"
    echo "[entrypoint] 已用镜像内置默认配置初始化: $CONFIG_FILE"
  else
    echo "[entrypoint] 错误: 配置文件 $CONFIG_FILE 不存在，且镜像内也无默认配置" >&2
    exit 1
  fi
fi

exec /app/registry-proxy "$CONFIG_FILE"
