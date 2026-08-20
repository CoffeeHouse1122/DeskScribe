# 全栈项目开发约束

## 1. 使用原则

- 本文件放在项目根目录，适用于全栈项目的创建、开发、审查和维护。
- 用户明确要求优先于本文件；已有项目遵循现有技术栈和目录，不擅自迁移框架或数据库。
- 信息不足且会影响架构时必须先询问，不得猜测。主要包括：项目画像、适用时的 JavaScript/TypeScript、部署环境、前后端运行关系和外部服务。
- 只修改当前任务需要的文件，不覆盖用户已有改动，不处理无关项目。
- 分析或审查任务默认只读；用户未要求修复时不得修改代码。

## 2. 默认技术方向

- 前端默认使用 Vue 3、Vite、axios、Composition API 和 ESM。
- 常规小项目后端默认使用 Node.js、Express 和 REST/JSON API。
- 中大型业务项目默认推荐 TypeScript + NestJS + PostgreSQL；AI、数据和算法型后端使用 Python + FastAPI；高并发、性能或资源占用敏感的独立服务默认使用 Go + Gin。项目边界不明确时先询问。
- Node.js 和前端包管理默认使用 npm，并提交 `package-lock.json`；不得混用包管理器。
- FastAPI 项目初始化时确认 Python 依赖管理方式；依赖必须完整声明并固定版本，不得混用 `requirements.txt`、Poetry、uv 等多套方案。
- Vue 前端、Express 和 Electron 的 Node.js 代码初始化时必须询问使用 JavaScript 还是 TypeScript；NestJS 固定使用 TypeScript，FastAPI 和 Go 不询问该项。
- 默认使用原生 CSS；只有用户明确指定时才引入 UI 组件库、CSS 预处理器或原子化 CSS 框架。
- 不设置默认字体；用户未指定时不引入自定义字体文件或字体依赖。
- Vue Router 和 Pinia 均按需安装：存在客户端路由时才安装 Vue Router；存在跨页面共享、复杂全局或持久化状态时才安装 Pinia；页面局部状态使用组件状态或 composable。
- Web 前端和 Electron renderer 不预设 ESLint、Vitest、Vue Test Utils 或 Playwright；用户明确要求或项目实际需要时再按需引入。
- Electron、Python/FastAPI 或 Go 独立服务不强套普通 Web 全栈结构，应使用对应项目画像。

### 2.1 统一 Vite 配置

Web 前端和 Electron renderer 使用同一套 Vite 基线：

- 使用 `defineConfig`、`loadEnv`、Vue plugin；`@` 固定指向前端或 renderer 的 `src`。
- `base`：开发环境固定 `./`；生产环境读取 `VITE_CDN_BASE`，未配置时回退 `./`。
- dev server：`host: "0.0.0.0"`、`port: 5173`、`strictPort: true`、HMR overlay 开启；Web 使用 `open: true`，Electron renderer 使用 `open: false`；禁止将 `allowedHosts` 设为 `true`。
- API 代理：`/api`、`/media` 指向 `VITE_API_PROXY_TARGET`，默认 `http://localhost:3000`。
- Web build：`outDir: "dist"`、`assetsDir: "assets"`、`assetsInlineLimit: 4096`、`minify: "esbuild"`、`chunkSizeWarningLimit: 1000`。
- 生产环境关闭 sourcemap，并移除 `console`、`debugger`；开发环境保留 sourcemap。
- 输出统一为 `static/js/[name]-[hash].js`、`static/css/[name]-[hash].css`、`static/images/[name]-[hash][extname]`，其他资源进入 `static/[ext]/`。
- 旧浏览器兼容由 `VITE_LEGACY=true` 显式开启，默认不加载 legacy plugin。
- Electron 默认使用 electron-vite；renderer 继续遵守上述 alias、env、sourcemap 和资源规则，renderer、main、preload 使用互相独立的输出目录。
- 项目确需偏离基线时，必须在配置旁注释原因，并更新 README。

### 2.2 统一命令

全栈 Web 项目根目录统一提供：

- 开发：`dev` 同时启动前后端；`dev:frontend`、`dev:backend` 分别启动。
- 构建：`build` 完整构建；`build:frontend`、`build:backend` 分别构建；`start` 启动生产服务。
- 检查：必须提供 `check`；`lint`、`test`、`typecheck` 仅在项目实际引入对应工具时提供。`check` 聚合所有实际检查和完整构建。
- FastAPI 或 Go 作为全栈 Web 后端时，根脚本必须明确以 `backend/` 为工作目录执行；独立后端服务使用对应画像的原生命令，不得只为包装命令额外引入 npm。
- FastAPI 后端的 `dev:backend`、`start` 调用实际 Python 服务，`build:backend` 执行真实的导入/部署校验或制品构建，不得使用空脚本代替。
- Go 后端在 `backend/` 中使用 `go run ./cmd/server`、`go vet ./...`、`go test ./...` 和真实二进制构建；作为全栈后端时分别映射到根 `dev:backend`、`check` 和 `build:backend`。
- 使用数据库迁移时，根目录统一提供 `db:revision`、`db:migrate`、`db:status`，并映射到项目实际使用的迁移工具，不得使用空脚本占位。

Electron 项目根目录统一提供：

- 开发：`dev` 同时启动；`dev:renderer`、`dev:electron` 分别启动。
- 构建：`build` 完整构建；`build:main`、`build:renderer` 分别构建。
- 打包：`pack` 生成目录包；`dist` 生成当前平台安装包；`dist:win` 生成 Windows 安装包。
- 检查：必须提供 `check`；`lint`、`typecheck`、`test` 仅在项目实际引入对应工具时提供。`check` 聚合实际检查和完整构建。

可以增加业务命令，但不得用空脚本、固定成功输出或仅打印提示来伪造统一命令。

## 3. 新项目初始化

创建项目前先确认：产品目标、用户与权限、部署方式、前后端运行关系、数据库、文件存储、外部服务和第一阶段范围；使用 Vue 前端、Express 或 Electron Node.js 代码时，同时确认 JavaScript/TypeScript。

常规 Express Web 项目默认目录如下，只创建实际需要的目录；NestJS、FastAPI、Go 和 Electron 使用各自项目画像：

```text
frontend/
  public/
  src/
    api/
    assets/
    components/
      base/
      business/
    composables/
    layouts/
    router/                   使用 Vue Router 时创建
    stores/                   使用 Pinia 时创建
    styles/
    types/
    utils/
    views/
    App.vue
    main.js|ts
  tests/                      实际引入前端测试工具时创建
  .env.example
  package.json
  vite.config.js|ts
backend/
  src/
    config/                  配置加载与校验
    controllers/             HTTP 输入输出
    middleware/              认证、权限、日志、错误处理
    routes/                  路由注册
    services/                业务逻辑
    repositories/            数据访问
    models/                  数据模型
    jobs/                    定时和后台任务
    utils/                   无业务含义的工具
    app.js|ts                Express 应用
    server.js|ts             服务启动入口
  database/
    migrations/
    seeds/
  tests/
  .env.example
  package.json
docs/                        架构、API 和运维说明
.gitignore
AGENTS.md
README.md
package.json                 统一启动、构建和检查脚本
```

初始化完成后必须具备所选项目画像的最小可运行骨架、配置校验、错误处理、日志入口、验证命令和 README；存在后端时提供健康检查 API，存在前端时提供统一请求层，使用数据库时提供迁移机制。不得生成无业务价值的示例模块或虚假数据。

### 3.1 NestJS + PostgreSQL 项目

中大型业务项目使用 NestJS 的模块化结构，不套用 Express 的 `routes/controllers` 全局分层目录：

```text
backend/
  src/
    common/                   通用 guard、pipe、filter、interceptor
    config/                   配置加载与校验
    database/
      migrations/
    modules/
      <feature>/
        dto/
        entities/
        <feature>.controller.ts
        <feature>.service.ts
        <feature>.module.ts
    app.module.ts
    main.ts
  test/
  .env.example
  package.json
  tsconfig.json
```

- 按业务能力建立 feature module；controller 只处理 HTTP 边界，service 组织业务，provider/repository 隔离基础设施和数据访问。
- 跨模块能力通过明确导出和依赖注入复用，禁止直接访问其他模块内部文件或建立循环依赖。
- PostgreSQL、TypeORM 和 migration 遵守第 7 节数据库规则；生产环境禁止自动同步 schema。

### 3.2 Python + FastAPI 项目

AI、数据或算法是主要能力时，FastAPI 可以独立承担完整后端；普通复杂业务仍使用 NestJS，混合项目由 NestJS 承担主业务、FastAPI 提供独立 AI/数据服务。

```text
backend/
  app/
    api/                     路由和 HTTP 输入输出
    core/                    配置、安全、日志和生命周期
    schemas/                 Pydantic 请求与响应模型
    services/                业务、AI 和数据流程
    repositories/            数据与外部服务访问
    models/                  SQLite Core 表定义或 PostgreSQL ORM 模型
    jobs/                    后台和定时任务
    main.py                  FastAPI 应用入口
  migrations/
  alembic.ini
  tests/
  .env.example
  requirements.txt|pyproject.toml
```

- route 只处理协议边界，Pydantic schema 负责验证，service 组织业务，repository 隔离数据库和外部服务。
- FastAPI + SQLite 默认使用 SQLAlchemy Core，通过 Python `sqlite3` 驱动执行参数化原生 SQL，不使用 ORM；数据库操作同步执行，并使用 Alembic 管理迁移。
- SQLite 同步数据库操作使用普通 `def` 路由或依赖；从 `async def` 调用时必须将完整 repository 或事务整体移交线程池，不得直接阻塞事件循环。
- FastAPI + PostgreSQL 默认使用 SQLAlchemy ORM、psycopg 3 异步驱动和 Alembic；每个请求或后台任务使用独立 `AsyncSession`，不得在并发任务间共享。
- FastAPI 的事务由 service 统一提交或回滚，repository 不自行 commit；生产环境禁止自动建表或自动同步结构，数据库变更必须使用版本化 migration。
- 支持 `await` 的 I/O 使用 `async def`；同步阻塞 I/O 不得占用事件循环，CPU 密集计算、模型推理和长任务移至 Worker、进程池、任务队列或独立服务。
- 生产使用 Uvicorn；Worker 数量、容器副本和连接池必须通过压测确定，多进程共享状态存入数据库或 Redis，不使用进程内全局变量。
- Python 代码使用类型标注；API、核心 service 和 repository 必须覆盖自动化测试。

### 3.3 Go + Gin 项目

高并发、性能或资源占用敏感的独立服务使用 Go + Gin；未达到该项目画像时不为追求形式改用 Go。

```text
backend/
  cmd/
    server/
      main.go                 服务入口
  internal/
    config/                   配置加载与校验
    handlers/                 Gin HTTP 输入输出
    middleware/               认证、日志、恢复和请求上下文
    routes/                   路由注册
    services/                 业务逻辑
    repositories/             数据访问，使用数据库时创建
    models/                   领域或持久化模型
    jobs/                     后台任务，按需创建
  migrations/                使用数据库时创建
  .env.example
  go.mod
  go.sum
```

- Gin handler 只处理 HTTP 边界，service 组织业务，repository 隔离数据访问；依赖通过构造函数显式注入，不使用可变包级全局状态。
- 请求 `context.Context` 必须向下传递，所有外部 I/O 设置超时；后台 goroutine 必须可取消、可回收，服务必须实现优雅关闭。
- 禁止跨 goroutine 使用原始 `*gin.Context`；交付前执行格式检查、`go vet ./...`、`go test ./...` 和真实二进制构建。
- Go 数据库驱动和迁移工具未确定时，初始化前询问，不自行选择。

## 4. Electron 桌面项目

全栈项目属于 Electron 桌面程序时，不创建普通 `frontend/backend` 骨架，改用：

- 新建 Electron 项目默认使用 electron-vite 负责开发和构建，使用 electron-builder 负责应用打包；包管理使用 npm 并提交 `package-lock.json`。
- 初始化时必须确认 `appId`、`productName`、Windows 安装包格式和代码签名要求，不得自行猜测。
- `pack` 由 electron-builder 生成目录包，`dist` 生成当前平台安装包，`dist:win` 生成 Windows 安装包。

```text
build/
  icons/                     打包和应用图标
docs/
src/
  electron/
    main/
      services/              文件、系统、音视频等原生能力
      utils/
      types/
    preload/                 contextBridge 白名单
  renderer/
    assets/
    components/
    pages/
    router/                   使用 Vue Router 时创建
    stores/                   使用 Pinia 时创建
    styles/
  shared/                    main、preload、renderer 共享契约
tests/                       实际引入测试工具时创建
electron.vite.config.js|ts
package.json
```

- main 只负责窗口生命周期、IPC 和原生能力；renderer 不直接访问 Node.js API。
- preload 只暴露按业务命名的最小 API，禁止透传原始 `ipcRenderer`。
- 所有窗口明确设置 `contextIsolation: true`、`nodeIntegration: false`、`webSecurity: true`；sandbox 默认开启，关闭时必须记录原因和替代防护。
- IPC handler 校验 sender、payload、权限和路径范围；文件读写只允许用户选择路径或应用数据目录。
- `shell.openExternal` 校验协议和域名；限制导航、新窗口和权限请求，并配置 CSP。
- 运行数据、日志和配置写入系统 `userData`，不得写入安装目录或源码目录。
- renderer 只处理界面与状态；本地业务能力优先放 main services，确需独立 HTTP 服务时再创建 backend。
- Electron、Chromium、Node 和原生依赖作为一个整体验证；交付前执行项目实际具备的检查、完整构建和目标平台打包。

## 5. 前端约束

- 页面、业务组件、基础组件、composable、store 和 API 层职责分离。
- Vue Router 和 Pinia 按需安装；页面局部状态不得为追求目录完整而放入 Pinia。
- Web 前端和 Electron renderer 不预设 ESLint、Vitest、Vue Test Utils 或 Playwright，需要时按项目引入。
- API 调用统一通过封装后的 axios request 实例；组件内禁止散落裸 `fetch`、硬编码地址或重复 token 逻辑。
- 页面覆盖 loading、empty、error、disabled/no-permission 状态。
- 禁止使用原生 `select`、`alert`、`confirm`、`prompt`；自定义下拉必须满足键盘和可访问性要求。
- 使用设计 token 统一颜色、间距、字体、圆角和状态语义。
- 前端动画库统一使用 GSAP，不再引入其他 JavaScript 动画库；简单 hover、focus 和显隐过渡可使用 CSS。
- GSAP 动画优先使用 transform 和 opacity；组件卸载时清理 context、timeline、ScrollTrigger 和事件监听，并适配 `prefers-reduced-motion`。
- 前端变量全部视为公开信息，禁止包含任何服务端秘密。
- `v-html`/`dangerouslySetInnerHTML` 不得渲染未经可靠净化的外部或用户内容。
- `App.vue` 和页面组件不得持续堆积全部业务；发现明显过大时先给出拆分方案。

## 6. 后端与 API

- route 只注册路由，controller 或 Gin handler 处理输入输出，service 承担业务，repository 负责数据访问。
- 路由、controller 和 Gin handler 中禁止直接拼接 SQL 或堆积复杂业务逻辑。
- 所有 body、query、params、header、文件和外部 API 响应在边界处验证。
- API 使用一致的 JSON 成功/错误结构；错误至少包含稳定 code、message 和 request_id。
- 认证与授权分开处理；所有敏感资源在服务端校验权限。
- 外部请求设置超时、错误映射和有限重试；非幂等请求不得盲目重试。
- 后台任务明确状态、幂等、失败重试和恢复策略。
- 不吞异常，不把堆栈、SQL、secret 或内部路径直接返回给客户端。

### 6.1 认证与会话

- 普通全栈 Web 默认使用服务端 Session；会话标识通过 `HttpOnly`、`SameSite` Cookie 传递，外网 HTTPS 环境同时启用 `Secure`。
- 生产环境禁止使用进程内 Memory Store。项目已使用 PostgreSQL 时，Session Store 默认使用 PostgreSQL；仅使用 SQLite 的小型单机项目允许将 Session 持久化到 SQLite。
- Redis 不默认引入；仅在高会话吞吐、多实例共享、集中 TTL 或撤销等明确需求下按需使用。多实例必须使用 PostgreSQL 或 Redis 共享会话。
- Electron 和独立 API 默认使用短期 JWT Access Token + 可轮换 Refresh Token；JWT Payload 不含敏感数据，Access Token 只存内存，Refresh Token 不得明文存入 SQLite 或 Web Storage。
- axios 仅在 JWT 模式下注入 Access Token；并发 `401` 合并为一次刷新，每个请求最多刷新并重试一次。
- 退出时服务端撤销 Session 或 Refresh Token 并清除客户端状态；认证不替代服务端授权校验。

## 7. 数据库与文件

- 新项目按项目画像选择数据库：小型项目使用 SQLite，中大型 NestJS 项目使用 PostgreSQL；已有项目不得擅自更换数据库，边界不明确时先询问。
- schema 变更通过 migration，禁止启动时静默执行破坏性变更。
- 查询必须参数化；事务覆盖需要原子完成的多步写入。
- 新建 Node.js 和 Electron SQLite 项目默认使用 `better-sqlite3` + 参数化原生 SQL，通过 repository 隔离数据访问，不引入 ORM；已有项目使用 `DatabaseSync` 时继续沿用，不主动迁移。
- FastAPI + SQLite、FastAPI + PostgreSQL 分别遵守 FastAPI 项目画像的 SQLAlchemy Core/ORM 和 Alembic 规则。
- NestJS + PostgreSQL 默认使用 TypeORM；生产环境禁止 `synchronize: true`，结构变化必须通过 migration。
- 数据库表名和字段名使用 `snake_case`，代码变量使用 `camelCase`，类使用 `PascalCase`；原生业务 SQL 只能位于 repository，migration、seed 和运维脚本除外。
- 跨设备同步、离线数据和对外业务实体使用 UUID；纯本地 SQLite 内部表可以使用 `INTEGER PRIMARY KEY`。
- 默认真实删除；只有明确需要恢复、审计或保留引用时才使用 `deleted_at` 软删除。
- 核心数据包含 `created_at`、`updated_at`，时间统一以 UTC 保存。

### 7.1 Node.js 与 Electron SQLite 同步 API

- Node.js 和 Electron 的本地、单用户、低并发项目默认使用 `better-sqlite3` 同步 API；已有项目可以继续沿用 `DatabaseSync`，但仅执行有索引的短查询和短事务。
- 禁止在 Node.js HTTP 请求链或 Electron main 中执行不受数据量限制的全表扫描、批量导入导出、复杂统计、迁移和备份；此类任务移至 Worker Thread、Electron `utilityProcess` 或独立服务。
- Electron renderer 禁止直接访问 SQLite，必须通过最小化、可校验的 IPC 接口调用；不得用 `async/await` 包装同步 API 并将其视为非阻塞操作。
- 出现事件循环阻塞时，将重任务移至 Worker Thread、Electron `utilityProcess` 或独立进程；出现持续写锁竞争或多实例并发写入时改用 PostgreSQL，异步封装不能消除 SQLite 的写入串行限制。

### 7.2 SQLite 与 PostgreSQL

- 同一项目可以同时使用 SQLite 和 PostgreSQL，但必须明确数据所有权：SQLite 用于 Electron 本地数据、离线缓存和待同步队列，PostgreSQL 用于服务端权威数据；不需要离线或本地持久化时不额外引入 SQLite。
- 禁止在一次业务操作中无保护地同时写入两个数据库；同步机制必须定义 UUID、版本号、更新时间、幂等键、删除标记、失败重试和冲突解决策略。
- PostgreSQL 集成测试使用真实 PostgreSQL 测试实例，不得使用 SQLite 替代。

- 文件默认存储在环境配置指定的本地根目录，并按 `YYYY/MM/DD` 分类；Electron 文件存入系统 `userData`，用户明确指定时才改用对象存储。
- 上传文件限制类型、MIME、大小和数量；服务端生成文件名并防止路径穿越。
- 上传、生成文件、数据库、备份和运行数据不得存入源码目录或提交 Git。
- 数据库固定按 `Asia/Shanghai` 时区每日 `02:30` 自动备份到配置的备份目录，保留最近 7 天，不依赖服务器、容器或操作系统的本地时区。
- 多实例部署只允许一个备份调度器执行，并以日期保证幂等；Electron 在计划时间未运行时，于下次启动补执行一次当日缺失备份。
- 日志写入配置的本地日志根目录并按日期分类，access、app、error 和进程日志职责分离，保留最近 180 天。

## 8. 日志、安全与环境配置

- 服务端日志使用结构化 JSON，至少包含 timestamp、level、event、request_id、method、path、status_code 和 duration_ms。
- access、app、error 和进程日志职责分离；敏感字段统一脱敏。
- 密码、token、cookie、authorization、secret、api key、client secret 和私钥不得进入源码、日志、响应、文档或 Git。
- 真实 `.env` 不提交；前后端分别提供 `.env.example`，每个变量写明用途、是否必填和示例值。
- 内网全栈项目允许使用 HTTP；账号、密码等敏感请求参数按前后端约定先进行应用层加密，但不得将其描述为 TLS 的替代方案，并须记录 Session/Token 仍可能被截获的风险。
- 外网前端及任何互联网公开服务必须使用 HTTPS。
- 文件、接口和数据库操作遵循最小权限；安全例外必须记录原因和替代防护。

## 9. 代码质量与测试

- 注释默认使用英文，解释业务原因、边界和重要决策，不逐行翻译代码。
- 不用禁用规则、删除测试、空脚本或滥用 `any` 让检查通过。
- 后端 bug 修复必须补回归测试，业务计算、权限、数据转换和 repository 必须有单元测试；Web 前端和 Electron renderer 遵守前述按需引入测试体系的规则。
- API 至少覆盖成功、参数错误、未认证/无权限和内部失败路径。
- Web 前端和 Electron renderer 只提供实际引入的 `lint`、`typecheck`、`test` 脚本；尚无测试体系而任务需要自动化测试时，先询问是否引入。
- `build` 和根 `check` 必须真实可执行；根 `check` 聚合前后端实际检查和完整构建，并可在主开发系统运行。
- 交付前执行相关检查；未执行项和原因必须明确说明。

## 10. 文档、Git 与交付

- README 至少包含项目目的、架构、环境要求、配置、启动、构建、迁移、验证和部署方式。
- API、数据库、认证、目录架构或部署方式变化时同步更新对应文档。
- 不提交依赖目录、构建产物、安装包、缓存、日志、真实环境文件、数据库、上传和临时文件。
- 修改前先执行 `git status`，确认当前工作区状态。
- 不得覆盖、回滚或删除用户已有的未提交改动；只修改与当前任务相关的文件。
- 完成修改后运行与改动相关的必要测试、检查或构建；未执行的项目及原因必须说明。
- 提交前再次执行 `git status`，确认变更范围，并检查敏感信息与忽略项。
- 只使用 `git add -- <本次任务相关路径>` 暂存本次任务文件；禁止默认使用 `git add -A`、`git add .` 或暂存无关改动。
- 验证通过且存在实际文件变化时，自动执行本地 `git commit`；提交信息使用中文，简洁说明本次修改，不创建空提交。
- 当前项目不是 Git 仓库时，确认目标项目根目录且父目录不属于其他仓库后再执行 `git init`，避免创建嵌套仓库。
- 不得自动执行 `git push`。
- 禁止执行 `git reset --hard`、强制 push 或删除未经用户确认的文件。
- 最终回复必须包含 commit hash。
- 最终回复必须说明完成内容、修改文件、迁移影响、实际验证、未验证项、假设和剩余风险。
