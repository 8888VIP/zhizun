// 仅填写已经确认的店铺事实；不要把猜测、营销话术或临时活动写入这里。
// 可按顾客最满意的方面补充相关内容，生成时会优先使用对应条目。
const knowledgeByHighlight = {
  产品口味: [],
  服务态度: [],
  用餐体验: [],
  性价比: [],
  其他: []
};

export function getShopKnowledge(highlight) {
  const entries = knowledgeByHighlight[highlight] || [];
  return entries.length
    ? entries.map((entry) => `- ${entry}`).join('\n')
    : '当前未配置与该方面相关的店铺背景知识。不得补充或编造未提供的具体事实。';
}
