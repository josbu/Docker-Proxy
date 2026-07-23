/**
 * SQLite 数据库管理模块
 */
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs').promises;
const logger = require('../logger');
const bcrypt = require('bcrypt');

// 数据库文件路径
const DB_PATH = path.join(__dirname, '../data/app.db');

class Database {
  constructor() {
    this.db = null;
  }

  /**
   * 初始化数据库连接
   */
  async connect() {
    try {
      // 确保数据目录存在
      const dbDir = path.dirname(DB_PATH);
      await fs.mkdir(dbDir, { recursive: true });

      return new Promise((resolve, reject) => {
        this.db = new sqlite3.Database(DB_PATH, (err) => {
          if (err) {
            logger.error('数据库连接失败:', err);
            reject(err);
          } else {
            logger.info('SQLite 数据库连接成功');
            resolve();
          }
        });
      });
    } catch (error) {
      logger.error('初始化数据库失败:', error);
      throw error;
    }
  }

  /**
   * 创建数据表
   */
  async createTables() {
    const tables = [
      // 用户表
      `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        login_count INTEGER DEFAULT 0,
        last_login DATETIME
      )`,

      // 配置表
      `CREATE TABLE IF NOT EXISTS configs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE NOT NULL,
        value TEXT NOT NULL,
        type TEXT DEFAULT 'string',
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // 文档表
      `CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_id TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        published BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // 系统日志表
      `CREATE TABLE IF NOT EXISTS system_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        details TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // Session表 - 用于存储用户会话
      `CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        sess TEXT NOT NULL,
        expire DATETIME NOT NULL
      )`,

      // 菜单项表 - 用于存储导航菜单配置
      `CREATE TABLE IF NOT EXISTS menu_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL,
        link TEXT NOT NULL,
        icon TEXT DEFAULT '',
        new_tab BOOLEAN DEFAULT 0,
        sort_order INTEGER DEFAULT 0,
        enabled BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // Registry 配置表 - 用于存储各 Registry 平台的启用状态和代理地址
      `CREATE TABLE IF NOT EXISTS registry_configs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        registry_id TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        icon TEXT,
        color TEXT,
        prefix TEXT,
        description TEXT,
        proxy_url TEXT,
        enabled BOOLEAN DEFAULT 0,
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // 资源指标历史表 - 用于跨设备/跨会话统一保存系统资源使用率（CPU/内存/磁盘百分比）
      `CREATE TABLE IF NOT EXISTS metric_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        cpu REAL,
        memory REAL,
        disk REAL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_metric_history_ts ON metric_history(ts)`,

      // 网络流量历史表 - 每 30s 记录一次全网卡累计 rx/tx 字节（非回环），
      // 用于「网络流量监控」页绘制历史吞吐曲线（相邻点差分得到每秒速率）。
      `CREATE TABLE IF NOT EXISTS network_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        rx_bytes INTEGER,
        tx_bytes INTEGER
      )`,
      `CREATE INDEX IF NOT EXISTS idx_network_history_ts ON network_history(ts)`,

      // Registry 凭证表 - 存储各 Registry 平台的访问凭证（username / password 或 PAT）
      // password 以 AES 加密存储，避免明文落库；仅供 token 获取流程内部解密使用。
      `CREATE TABLE IF NOT EXISTS registry_credentials (
        registry_id TEXT PRIMARY KEY,
        username TEXT NOT NULL DEFAULT '',
        password TEXT NOT NULL DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`
    ];

    for (const sql of tables) {
      await this.run(sql);
    }

    // 兼容老库：表结构已就绪后，补齐新增列与历史数据回填
    await this.ensureMenuIconColumn();
    // 兼容老库：确保内置「GitHub / 介绍」默认菜单项存在（仅当对应 text 不存在时插入）
    // 必须在 createTables 末尾执行，避免后续 createDefaultMenuItems 因"介绍"已存在而跳过，
    // 导致 GitHub 默认项在全新环境中缺失。
    await this.ensureDefaultMenuItems();

    logger.info('数据表创建完成');
  }

  /**
   * 执行SQL语句
   */
  async run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) {
          logger.error('SQL执行失败:', err);
          reject(err);
        } else {
          resolve({ id: this.lastID, changes: this.changes });
        }
      });
    });
  }

  /**
   * 查询单条记录
   */
  async get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) {
          logger.error('SQL查询失败:', err);
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  /**
   * 查询多条记录
   */
  async all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          logger.error('SQL查询失败:', err);
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }



  /**
   * 初始化默认管理员用户
   */
  async createDefaultAdmin() {
    try {
      const adminUser = await this.get('SELECT id FROM users WHERE username = ?', ['root']);
      
      if (!adminUser) {
        const hashedPassword = await bcrypt.hash('admin@123', 10);
        await this.run(
          'INSERT INTO users (username, password, created_at, login_count, last_login) VALUES (?, ?, ?, ?, ?)',
          ['root', hashedPassword, new Date().toISOString(), 0, null]
        );
        logger.info('默认管理员用户创建成功，请及时修改默认密码');
      }
    } catch (error) {
      logger.error('创建默认管理员用户失败:', error);
    }
  }

  /**
   * 创建默认文档
   */
  async createDefaultDocuments() {
    try {
      const docCount = await this.get('SELECT COUNT(*) as count FROM documents');
      
      if (docCount.count === 0) {
        const defaultDocs = [
          {
            doc_id: 'welcome',
            title: '欢迎使用 Docker 镜像代理加速系统',
            content: `## 系统介绍

Docker Proxy 是一套**自建 Docker 镜像代理加速与管理服务**，支持 Docker Hub、GHCR、Quay、K8s、MCR、Elastic、NVCR 等主流上游镜像仓库的一键部署，并通过 Web 管理后台（HubCMD-UI）集中管理代理配置，帮助您加速 Docker 镜像的下载与部署。

## 核心特性

- 🚀 **零磁盘缓存 · 流式转发**：单进程按 Host 自动路由到各大公共仓库，服务端完成 Token 鉴权并流式转发，不落盘、不占用本地存储
- 🐳 **多 Registry 支持**：内置 Docker Hub、GHCR、Quay、K8s、MCR、Elastic、NVCR 等代理，一键启停
- 🔧 **一键部署**：自动检查并安装 Docker / Compose 依赖，支持镜像版直拉或源码构建两种方式
- 🔐 **账号认证**：可配置上游账号密码，由代理服务端换取 Bearer Token，拉取 Docker Hub 私有镜像并缓解官方限流
- 🖥️ **HubCMD-UI 管理面板**：网页端直接增删改代理、设置服务器参数并热重载；含镜像搜索、文档教程、容器管理、监控告警
- 🌐 **可选反代**：自动部署 Nginx 或 Caddy 反代并渲染配置（HTTPS、Host 改写）
- 📦 **跨平台 & 运维**：支持 linux/amd64、linux/arm64；提供服务启动 / 停止 / 重启 / 日志 / 更新 / 卸载全生命周期管理

## 支持的上游镜像仓库

| Registry | 说明 |
| --- | --- |
| Docker Hub | Docker 官方镜像仓库 |
| GHCR | GitHub Container Registry |
| Quay | Red Hat Quay 公共仓库 |
| K8s | Kubernetes 相关镜像 |
| MCR | Microsoft Container Registry |
| Elastic | Elastic 官方镜像 |
| NVCR | NVIDIA Container Registry |

## 快速开始

1. 访问管理面板（默认 http://服务器IP:30080/admin）完成基础配置
2. 配置 Docker 客户端使用本代理地址作为镜像加速源
3. 开始享受加速的镜像下载体验

## 更多信息

更多部署与配置说明，请查看项目文档或访问 GitHub 仓库：https://github.com/dqzboy/Docker-Proxy`,
            published: 1
          },
          {
            doc_id: 'docker-config',
            title: 'Docker 客户端配置指南',
            content: `## 配置说明

使用本代理服务需要配置 Docker 客户端的镜像仓库地址。

## Linux/macOS 配置

编辑或创建 \`/etc/docker/daemon.json\` 文件：

\`\`\`json
{
  "registry-mirrors": [
    "http://your-proxy-domain.com"
  ]
}
\`\`\`

重启 Docker 服务：
\`\`\`bash
sudo systemctl restart docker
\`\`\`

## Windows 配置

在 Docker Desktop 设置中：
1. 打开 Settings -> Docker Engine
2. 添加配置到 JSON 文件中
3. 点击 "Apply & Restart"

## 验证配置

运行以下命令验证配置是否生效：
\`\`\`bash
docker info
\`\`\`

在输出中查看 "Registry Mirrors" 部分。`,
            published: 1
          }
        ];

        for (const doc of defaultDocs) {
          await this.run(
            'INSERT INTO documents (doc_id, title, content, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
            [doc.doc_id, doc.title, doc.content, doc.published, new Date().toISOString(), new Date().toISOString()]
          );
        }
      }
    } catch (error) {
      logger.error('创建默认文档失败:', error);
    }
  }

  /**
   * 检查数据库是否已经初始化
   */
  async isInitialized() {
    try {
      // 先检查是否有用户表
      const tableExists = await this.get("SELECT name FROM sqlite_master WHERE type='table' AND name='users'");
      if (!tableExists) {
        return false;
      }
      
      // 检查是否有初始化标记
      const configTableExists = await this.get("SELECT name FROM sqlite_master WHERE type='table' AND name='configs'");
      if (configTableExists) {
        const initFlag = await this.get('SELECT value FROM configs WHERE key = ?', ['db_initialized']);
        if (initFlag) {
          return true;
        }
      }
      
      // 检查是否有用户数据
      const userCount = await this.get('SELECT COUNT(*) as count FROM users');
      return userCount && userCount.count > 0;
    } catch (error) {
      // 如果查询失败，认为数据库未初始化
      return false;
    }
  }

  /**
   * 标记数据库已初始化
   */
  async markAsInitialized() {
    try {
      await this.run(
        'INSERT OR REPLACE INTO configs (key, value, type, description) VALUES (?, ?, ?, ?)',
        ['db_initialized', 'true', 'boolean', '数据库初始化标记']
      );
      logger.info('数据库已标记为已初始化');
    } catch (error) {
      logger.error('标记数据库初始化状态失败:', error);
    }
  }

  /**
   * 关闭数据库连接
   */
  async close() {
    return new Promise((resolve, reject) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) {
            logger.error('关闭数据库连接失败:', err);
            reject(err);
          } else {
            logger.info('数据库连接已关闭');
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * 清理过期的会话
   */
  async cleanExpiredSessions() {
    try {
      const result = await this.run(
        'DELETE FROM sessions WHERE expire < ?',
        [new Date().toISOString()]
      );
      if (result.changes > 0) {
        logger.info(`清理了 ${result.changes} 个过期会话`);
      }
    } catch (error) {
      logger.error('清理过期会话失败:', error);
    }
  }

  /**
   * 创建默认菜单项
   * 注：顶部"首页"由 Landing.vue 模板硬编码（保持现状），此处只种子化可被管理员编辑的入口。
   * 仅当表为空时插入，保留已有数据。
   * 升级库由 createTables 末尾的 ensureDefaultMenuItems 负责幂等补全默认项，
   * 此处不重复插入，避免与 ensureDefaultMenuItems 顺序冲突。
   */
  async createDefaultMenuItems() {
    try {
      const menuCount = await this.get('SELECT COUNT(*) as count FROM menu_items');

      if (menuCount.count === 0) {
        const defaultMenuItems = [
          // 顶部 GitHub 入口：用户可在后台「菜单管理」自由编辑文字、链接、是否新标签页打开
          { text: 'GitHub', link: 'https://github.com/dqzboy/Docker-Proxy', icon: 'github', new_tab: 1, sort_order: 1 },
          // 顶部「介绍」入口：指向项目介绍站点，同样可在后台「菜单管理」自由编辑
          { text: '介绍', link: 'https://docker-proxy-desc.vercel.app/', icon: 'book-open', new_tab: 1, sort_order: 2 }
        ];

        for (const item of defaultMenuItems) {
          await this.run(
            'INSERT INTO menu_items (text, link, icon, new_tab, sort_order, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [item.text, item.link, item.icon || '', item.new_tab, item.sort_order, 1, new Date().toISOString(), new Date().toISOString()]
          );
        }
        logger.info('默认菜单项（GitHub / 介绍）已创建');
      }
    } catch (error) {
      logger.error('创建默认菜单项失败:', error);
    }
  }

  /**
   * 幂等确保「GitHub / 介绍」两个内置默认菜单项存在。
   * 用于已存在数据的老库 / 全新环境：createDefaultMenuItems 仅在空库时全量种子化，
   * 为避免覆盖用户自定义菜单，这里按 text 逐项判断（不存在才插入），
   * 解决"全新环境因 createTables 末尾先补介绍，导致后续 createDefaultMenuItems 跳过，
   * GitHub 默认项始终缺失"的问题。
   */
  async ensureDefaultMenuItems() {
    const builtIn = [
      { text: 'GitHub', link: 'https://github.com/dqzboy/Docker-Proxy', icon: 'github', new_tab: 1, sort_order: 1 },
      { text: '介绍', link: 'https://docker-proxy-desc.vercel.app/', icon: 'book-open', new_tab: 1, sort_order: 2 }
    ];
    try {
      for (const item of builtIn) {
        const row = await this.get('SELECT COUNT(*) as count FROM menu_items WHERE text = ?', [item.text]);
        if (row.count === 0) {
          await this.run(
            'INSERT INTO menu_items (text, link, icon, new_tab, sort_order, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [item.text, item.link, item.icon || '', item.new_tab, item.sort_order, 1, new Date().toISOString(), new Date().toISOString()]
          );
          logger.info(`已补充默认菜单项（${item.text}）`);
        }
      }
    } catch (error) {
      logger.error('补充默认菜单项失败:', error);
    }
  }

  /**
   * 兼容老库：检测 menu_items 是否已存在 icon 列，若不存在则 ALTER TABLE 补列。
   * 同时回填已知菜单项的 icon（如默认 GitHub 入口 → 'github'）。
   * createTables 走 IF NOT EXISTS，老库结构不会自动加列，需显式迁移。
   */
  async ensureMenuIconColumn() {
    try {
      const cols = await this.all("PRAGMA table_info(menu_items)");
      const hasIcon = cols.some(c => c.name === 'icon');
      if (!hasIcon) {
        await this.run("ALTER TABLE menu_items ADD COLUMN icon TEXT DEFAULT ''");
        logger.info('已为 menu_items 表新增 icon 列（兼容老库）');
      }
      // 回填：默认 GitHub 入口的 icon 字段（基于链接识别，幂等）
      await this.run(
        "UPDATE menu_items SET icon = 'github' WHERE (icon IS NULL OR icon = '') AND (LOWER(text) = 'github' OR LOWER(link) LIKE '%github.com%')"
      );
    } catch (error) {
      logger.error('迁移 menu_items.icon 失败:', error);
    }
  }
}

// 创建数据库实例
const database = new Database();

module.exports = database;
