import 'dotenv/config';
import express from 'express';
import OpenAI from 'openai';
import { join } from 'node:path';
import { db, dbReady, all, projectRoot, run } from './db.mjs';

const app = express();
const port = process.env.PORT || 3000;
const openai = process.env.DEEPSEEK_API_KEY ? new OpenAI({
  baseURL: 'https://api.deepseek.com',
  apiKey: process.env.DEEPSEEK_API_KEY
}) : null;

const systemPrompt = `你是一个帮助顾客根据自己的真实体验，写出一段自然、口语化好评的助手。你的任务是根据顾客提供的信息，生成一段可以直接发布到点评平台的评论文案。

【输入信息】
你会收到以下顾客填写的内容：
- 店铺名称：至尊披萨
- 店铺类型：披萨/西式简餐
- 最满意的方面：{顾客选择}
- 顾客的补充说明（可能为空）：{顾客填写的开放式文字}
- 满意度评分：{1-5星}

【生成规则】
1. 文案长度控制在150-300字，符合真实顾客发布评论的长度和语气，不要写成营销软文
2. 语气自然、口语化，像真实顾客随手写的评论，允许有一点点不完美，避免“完美到假”
3. 如果顾客填写了补充说明，必须把这段真实内容自然地融入文案，作为评论的核心细节，不能只是套用模板
4. 如果补充说明为空，就根据“最满意的方面”合理展开一个具体、有细节感的场景，避免空洞夸赞
5. 每次生成都要在句式结构、开头方式、用词上做变化
6. 不要使用过度营销化的词汇，比如“绝绝子”“性价比之王”“必须打卡”
7. 不要编造顾客没有提到的具体事实，除非顾客自己提到了
8. 严禁生成虚假身份信息、虚假到店时间等内容

【输出格式】
只输出评论正文本身，不要加任何前缀说明、引号或者“以下是您的评论”这类话。`;

const allowedHighlights = new Set(['产品口味', '服务态度', '用餐体验', '性价比', '其他']);

app.use(express.json());
app.use('/images', express.static(join(projectRoot, 'public', 'images')));
app.use(express.static(projectRoot));

app.get('/api/images', async (request, response) => {
  const { tag } = request.query;
  if (!['口味', '环境'].includes(tag)) {
    response.status(400).json({ error: 'tag 必须是“口味”或“环境”' });
    return;
  }
  try {
    await dbReady;
    const images = await all(`SELECT id, image_path, tag, status, last_used_at
      FROM images WHERE tag = ? AND status = 'available' ORDER BY RANDOM() LIMIT 5`, [tag]);
    response.json({ tag, images });
  } catch (error) {
    console.error('读取图片列表失败:', error.message);
    response.status(500).json({ error: '读取图片列表失败' });
  }
});

app.post('/api/generate-review', async (request, response) => {
  const { highlight, detail = '', rating, selected_image_paths = [], regenerate = false } = request.body || {};
  const numericRating = Number(rating);
  const imagePaths = Array.isArray(selected_image_paths) ? [...new Set(selected_image_paths)].slice(0, 3) : [];

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
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: regenerate ? 0.95 : 0.7,
      stream: false
    });
    const content = completion.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error('DeepSeek 返回内容为空');

    if (imagePaths.length) {
      const placeholders = imagePaths.map(() => '?').join(',');
      const available = await all(`SELECT image_path FROM images WHERE status = 'available' AND image_path IN (${placeholders})`, imagePaths);
      if (available.length !== imagePaths.length) {
        response.status(409).json({ error: '部分图片已被其他顾客选用，请返回重新选择' });
        return;
      }
    }

    const now = new Date().toISOString();
    for (const imagePath of imagePaths) {
      await run(`UPDATE images SET status = 'cooling', last_used_at = ? WHERE image_path = ? AND status = 'available'`, [now, imagePath]);
    }
    await run(`INSERT INTO reviews (highlight, detail, rating, generated_content, selected_image_paths) VALUES (?, ?, ?, ?, ?)`, [
      highlight, String(detail).trim(), numericRating, content, JSON.stringify(imagePaths)
    ]);
    response.json({ branch: 'review', review: content, selected_image_paths: imagePaths });
  } catch (error) {
    console.error('生成评价失败:', error.message);
    response.status(502).json({ error: '评价生成失败，请稍后重试' });
  }
});

app.post('/api/feedback', async (request, response) => {
  const feedbackContent = String(request.body?.feedback_content || '').trim();
  if (!feedbackContent) {
    response.status(400).json({ error: '请填写具体问题' });
    return;
  }
  try {
    await dbReady;
    await run('INSERT INTO private_feedback (feedback_content) VALUES (?)', [feedbackContent]);
    response.json({ success: true });
  } catch (error) {
    console.error('保存私密反馈失败:', error.message);
    response.status(500).json({ error: '反馈保存失败，请稍后重试' });
  }
});

await dbReady;
app.listen(port, () => console.log(`Pizza review assistant running at http://localhost:${port}`));
