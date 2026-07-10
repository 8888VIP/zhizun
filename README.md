# 至尊披萨评价助手

面向“至尊披萨（洋湖荟聚店）”顾客的手机网页应用。顾客填写真实体验后：4–5 星由 DeepSeek 生成自然的点评文案；1–3 星进入仅供店长查看的私密反馈流程。后台可管理图片库并查看私密反馈。

## 本地启动

1. 安装依赖：

   ```bash
   npm install
   ```

2. 复制 `.env.example` 为 `.env`，填写环境变量：

   ```env
   DEEPSEEK_API_KEY=你的 DeepSeek API Key
   ADMIN_PASSWORD=你的后台管理密码
   DB_PATH=./data/database.db
   ```

3. 启动开发服务：

   ```bash
   npm run dev
   ```

4. 打开 `http://localhost:3000`。管理后台地址为 `http://localhost:3000/admin`。

## 生产环境启动

```bash
npm start
```

## Railway 部署

在 Railway 项目中设置以下环境变量：

| 变量 | 用途 |
| --- | --- |
| `DEEPSEEK_API_KEY` | DeepSeek 文案生成服务密钥 |
| `ADMIN_PASSWORD` | `/admin` 管理后台登录密码 |
| `DB_PATH` | SQLite 数据库绝对路径，例如 `/app/data/database.db` |

为 Railway 服务添加一个 Volume，并将其挂载到 `/app/data`。然后将 `DB_PATH` 设为 `/app/data/database.db`。

数据库文件和图片目录会自动位于同一个持久化目录中：

```text
/app/data/database.db
/app/data/images/
```

这样 Railway 重新部署或重启后，SQLite 数据库和上传图片都不会丢失。

推荐 Railway 配置：

```text
Build Command: npm install
Start Command: npm start
```

## 图片管理

部署上线后，所有图片都通过 `/admin` 后台的“上传图片”功能管理：选择图片、选择“口味”或“环境”标签后上传即可。无需再修改代码、上传图片到 GitHub，或手动操作服务器文件。

上传限制：JPG、PNG、WebP；单张不超过 5MB；每次最多 10 张。

图片在顾客生成评价后会进入 14 天冷却期，运行下面的命令可手动重置到可用状态：

```bash
npm run reset:images
```
