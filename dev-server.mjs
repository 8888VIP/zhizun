import 'dotenv/config';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import express from 'express';
import OpenAI from 'openai';
import multer from 'multer';
import { extname, join } from 'node:path';
import { dbReady, all, imageDir, projectRoot, run } from './db.mjs';
import { getShopKnowledge } from './shop-knowledge.js';

const app = express();
const port = process.env.PORT || 3000;
const openai = process.env.DEEPSEEK_API_KEY ? new OpenAI({
  baseURL: 'https://api.deepseek.com',
  apiKey: process.env.DEEPSEEK_API_KEY
}) : null;

const createSystemPrompt = (shopKnowledge) => `你是一个帮助顾客根据自己的真实体验，写出一段自然、口语化好评的助手。你的任务是根据顾客提供的信息，生成一段可以直接发布到点评平台的评论文案。

【店铺背景知识，写作时可以自然融入，让文案更具体、更有“这家店”的辨识度，不要生硬堆砌】
${shopKnowledge}

【输入信息】
- 店铺名称：至尊披萨
- 店铺类型：披萨/西式简餐
- 最满意的方面：{顾客选择}
- 顾客的补充说明（可能为空）：{顾客填写的开放式文字}
- 满意度评分：{1-5星}

【生成规则】
1. 文案长度控制在30到100字之间，长度不要每次都差不多，有的可以短一点（30字左右），有的可以稍长，模拟真实顾客写评论时长短不一的随意感
2. 只重点写1-2个点，不要面面俱到。真实顾客写评论通常只对某一两件事印象深刻，其他部分一带而过甚至不提，不要把“口味、环境、服务、性价比”都夸一遍
3. 严禁使用以下这类AI高频套话（一旦出现视为不合格）：“味道非常棒” “服务态度很好” “环境优雅” “性价比很高” “下次还会再来” “强烈推荐” “值得一试” “总的来说” “总而言之” “不虚此行” “深受感动” “让人流连忘返”
4. 句式要参差不齐：有的句子很短（甚至几个字成一句），有的句子稍长带点小啰嗦，避免每句话长度都差不多、都是完整主谓宾的“教科书式”句子
5. 允许有一点点“不完美”：比如轻微的口语重复（“真的真的很好吃”）、语气词（“哎”、“说实话”、“讲真”）、甚至一个无伤大雅的小抱怨夹在夸奖中间（比如“就是有点等位，不过味道确实值这个时间”）
6. 如果顾客填写了补充说明，这段真实内容必须是文案的核心，用顾客自己的话去展开，不要用你自己的书面语重新概括它
7. 如果补充说明为空，就结合上方“店铺背景知识”里的具体细节展开（比如具体某款披萨的名字、某个食材特点），不要写空洞的泛泛之词
8. 不要用“完美的三段式”结构（开头总述+中间展开+结尾总结），真实评论往往想到哪写到哪，可以从任何一个点直接切入
9. 不要编造顾客没提到的具体事实（价格、人名等），除非顾客自己提到或者店铺背景知识里明确写了

只输出评论正文本身，不要加任何前缀说明、引号。`;

const allowedHighlights = new Set(['产品口味', '服务态度', '用餐体验', '性价比', '其他']);
const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const adminSessions = new Set();

const upload = multer({
  storage: multer.diskStorage({
    destination: imageDir,
    filename: (_request, file, callback) => callback(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 10 },
  fileFilter: (_request, file, callback) => {
    if (!allowedImageTypes.has(file.mimetype)) callback(new Error('仅支持 JPG、PNG、WebP 格式'));
    else callback(null, true);
  }
});

function getCookie(request, name) {
  const cookies = String(request.headers.cookie || '').split(';').map((item) => item.trim());
  const item = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : null;
}

function requireAdmin(request, response, next) {
  if (!adminSessions.has(getCookie(request, 'admin_session'))) {
    response.status(401).json({ error: '请先登录管理后台' });
    return;
  }
  next();
}

app.use(express.json());
app.use('/images', express.static(imageDir));
app.get('/admin', (_request, response) => response.sendFile(join(projectRoot, 'admin.html')));
app.use(express.static(projectRoot));

app.post('/api/admin/login', (request, response) => {
  const password = String(request.body?.password || '');
  const expectedPassword = process.env.ADMIN_PASSWORD;
  if (!expectedPassword) {
    response.status(503).json({ error: '服务端尚未配置 ADMIN_PASSWORD' });
    return;
  }
  const matches = password.length === expectedPassword.length && timingSafeEqual(Buffer.from(password), Buffer.from(expectedPassword));
  if (!matches) {
    response.status(401).json({ error: '密码不正确' });
    return;
  }
  const token = randomUUID();
  adminSessions.add(token);
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  response.setHeader('Set-Cookie', `admin_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=28800${secure}`);
  response.json({ success: true });
});

app.post('/api/admin/logout', requireAdmin, (request, response) => {
  adminSessions.delete(getCookie(request, 'admin_session'));
  response.setHeader('Set-Cookie', 'admin_session=; HttpOnly; Path=/; Max-Age=0');
  response.json({ success: true });
});

app.get('/api/admin/check', (request, response) => response.json({ authenticated: adminSessions.has(getCookie(request, 'admin_session')) }));

app.get('/api/admin/image-stats', requireAdmin, async (_request, response) => {
  try {
    const rows = await all('SELECT tag, status, COUNT(*) AS count FROM images GROUP BY tag, status');
    response.json({ stats: rows });
  } catch (error) {
    response.status(500).json({ error: '读取图片库统计失败' });
  }
});

app.get('/api/admin/feedback', requireAdmin, async (_request, response) => {
  try {
    const feedback = await all(`SELECT id, created_at, feedback_content, rating FROM private_feedback
      ORDER BY datetime(created_at) DESC, id DESC LIMIT 300`);
    response.json({ feedback });
  } catch (error) {
    response.status(500).json({ error: '读取私密反馈失败' });
  }
});

app.post('/api/admin/upload-image', requireAdmin, upload.array('images', 10), async (request, response) => {
  const { tag } = request.body;
  const files = request.files || [];
  if (!['口味', '环境'].includes(tag)) {
    response.status(400).json({ error: '请选择图片标签：口味或环境' });
    return;
  }
  if (!files.length) {
    response.status(400).json({ error: '请至少选择一张图片' });
    return;
  }
  try {
    for (const file of files) {
      await run('INSERT INTO images (image_path, tag, status) VALUES (?, ?, ?)', [`/images/${file.filename}`, tag, 'available']);
    }
    const rows = await all('SELECT tag, status, COUNT(*) AS count FROM images GROUP BY tag, status');
    response.status(201).json({ uploaded: files.length, stats: rows });
  } catch (error) {
    console.error('上传图片失败:', error.message);
    response.status(500).json({ error: '图片入库失败' });
  }
});

app.get('/api/images', async (request, response) => {
  const { tag } = request.query;
  if (!['口味', '环境', '全部'].includes(tag)) {
    response.status(400).json({ error: 'tag 必须是“口味”“环境”或“全部”' });
    return;
  }
  try {
    await dbReady;
    await run(`UPDATE images SET status = 'available', last_used_at = NULL
      WHERE status = 'cooling' AND last_used_at IS NOT NULL
      AND datetime(last_used_at) <= datetime('now', '-14 days')`);

    const primaryWhere = tag === '全部' ? '' : 'WHERE tag = ?';
    const primaryParams = tag === '全部' ? [] : [tag];
    const primaryImages = await all(`SELECT id, image_path, tag, status, last_used_at FROM images ${primaryWhere}`, primaryParams);
    const fallbackImages = tag === '全部' ? [] : await all(`SELECT id, image_path, tag, status, last_used_at FROM images WHERE tag != ?`, [tag]);
    const randomize = (items) => [...items].sort(() => Math.random() - 0.5);
    const byStatus = (items, status) => items.filter((item) => item.status === status);
    const oldestFirst = (items) => [...items].sort((a, b) => String(a.last_used_at || '').localeCompare(String(b.last_used_at || '')));

    const selected = [
      ...randomize(byStatus(primaryImages, 'available')),
      ...randomize(byStatus(fallbackImages, 'available')),
      ...oldestFirst(byStatus(primaryImages, 'cooling')),
      ...oldestFirst(byStatus(fallbackImages, 'cooling'))
    ].slice(0, 6);
    const reusedCount = selected.filter((item) => item.status === 'cooling').length;
    response.json({ tag, images: selected, reused_count: reusedCount });
  } catch (error) {
    console.error('读取图片列表失败:', error.message);
    response.status(500).json({ error: '读取图片列表失败' });
  }
});

app.post('/api/generate-review', async (request, response) => {
  let { highlight, detail = '', rating, selected_image_paths = [], regenerate = false } = request.body || {};
  let numericRating = Number(rating);
  let imagePaths = Array.isArray(selected_image_paths) ? [...new Set(selected_image_paths)].slice(0, 3) : [];
  const requestedReviewId = Number(request.body?.review_id);

  if (!allowedHighlights.has(highlight) || !Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5) {
    response.status(400).json({ error: '问卷数据不完整或格式不正确' });
    return;
  }
  if (numericRating <= 3) {
    response.json({ branch: 'private-feedback' });
    return;
  }
  if (!openai) {
    response.status(503).json({ error: '服务端尚未配置 DEEPSEEK_API_KEY，请先填写 .env' });
    return;
  }

  let reviewId = null;
  if (regenerate) {
    if (!Number.isInteger(requestedReviewId) || requestedReviewId < 1) {
      response.status(400).json({ error: '缺少原始评价标识，无法重新生成' });
      return;
    }
    const [existingReview] = await all(`SELECT id, highlight, detail, rating, selected_image_paths
      FROM reviews WHERE id = ?`, [requestedReviewId]);
    if (!existingReview) {
      response.status(404).json({ error: '原始评价不存在，请返回重新提交' });
      return;
    }
    reviewId = existingReview.id;
    highlight = existingReview.highlight;
    detail = existingReview.detail || '';
    numericRating = existingReview.rating;
    try {
      imagePaths = JSON.parse(existingReview.selected_image_paths || '[]');
    } catch {
      imagePaths = [];
    }
  }

  const userMessage = `店铺名称：至尊披萨
店铺类型：披萨/西式简餐
最满意的方面：${highlight}
顾客补充说明：${String(detail).trim() || '无'}
满意度评分：${numericRating}星

请根据以上信息生成一段好评。${regenerate ? '\n这是第二次生成，请换一种完全不同的开头和句式结构，避免和上一版雷同。' : ''}`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'deepseek-v4-flash',
      messages: [
        { role: 'system', content: createSystemPrompt(getShopKnowledge(highlight)) },
        { role: 'user', content: userMessage }
      ],
      temperature: regenerate ? 0.95 : 0.7,
      stream: false
    });
    const content = completion.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error('DeepSeek 返回内容为空');

    if (regenerate) {
      await run('UPDATE reviews SET generated_content = ? WHERE id = ?', [content, reviewId]);
      response.json({ branch: 'review', review: content, review_id: reviewId, selected_image_paths: imagePaths });
      return;
    }

    if (imagePaths.length) {
      const placeholders = imagePaths.map(() => '?').join(',');
      const existingImages = await all(`SELECT image_path FROM images WHERE image_path IN (${placeholders})`, imagePaths);
      if (existingImages.length !== imagePaths.length) {
        response.status(400).json({ error: '所选图片无效，请返回重新选择' });
        return;
      }
    }

    const now = new Date().toISOString();
    for (const imagePath of imagePaths) {
      await run(`UPDATE images SET status = 'cooling', last_used_at = ? WHERE image_path = ?`, [now, imagePath]);
    }
    const reviewRecord = await run(`INSERT INTO reviews (highlight, detail, rating, generated_content, selected_image_paths) VALUES (?, ?, ?, ?, ?)`, [
      highlight, String(detail).trim(), numericRating, content, JSON.stringify(imagePaths)
    ]);
    response.json({ branch: 'review', review: content, review_id: reviewRecord.lastID, selected_image_paths: imagePaths });
  } catch (error) {
    console.error('生成评价失败:', error.message);
    response.status(502).json({ error: '评价生成失败，请稍后重试' });
  }
});

app.post('/api/feedback', async (request, response) => {
  const feedbackContent = String(request.body?.feedback_content || '').trim();
  const rating = Number(request.body?.rating);
  if (!feedbackContent || !Number.isInteger(rating) || rating < 1 || rating > 3) {
    response.status(400).json({ error: '请填写具体问题并保留原始评分' });
    return;
  }
  try {
    await dbReady;
    await run('INSERT INTO private_feedback (feedback_content, rating) VALUES (?, ?)', [feedbackContent, rating]);
    response.json({ success: true });
  } catch (error) {
    console.error('保存私密反馈失败:', error.message);
    response.status(500).json({ error: '反馈保存失败，请稍后重试' });
  }
});

app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError) {
    const message = error.code === 'LIMIT_FILE_SIZE' ? '单张图片不能超过 5MB' : error.code === 'LIMIT_FILE_COUNT' ? '一次最多上传 10 张图片' : '图片上传失败';
    response.status(400).json({ error: message });
    return;
  }
  response.status(400).json({ error: error.message || '请求处理失败' });
});

await dbReady;
app.listen(port, '0.0.0.0', () => console.log(`Pizza review assistant running on 0.0.0.0:${port}`));
