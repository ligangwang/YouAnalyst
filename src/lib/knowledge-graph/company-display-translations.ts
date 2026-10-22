/** Editorial reference translations, not claims about official Chinese legal names.
 * Keep the original brand beside the translation so the entity remains identifiable.
 * Existing Chinese names always take precedence in companyName().
 */
const translations: Record<string, string> = {
  'ORG:ANTHROPIC': '安思罗匹克',
  'ORG:MISTRAL-AI': '密斯特拉尔人工智能',
  'ORG:OPENAI': '开放人工智能',
  'US:ALAB': '阿斯特拉实验室',
  'US:ANET': '阿里斯塔网络',
  'US:ARM': '安谋',
  'US:CEG': '星座能源',
  'US:CRDO': '克雷多',
  'US:CRM': '赛富时',
  'US:CRWV': '科尔威夫',
  'US:DDOG': '数据狗',
  'US:DLR': '数字地产',
  'US:EQIX': '易昆尼克斯',
  'US:GEV': '通用电气维诺瓦',
  'US:GOOGL': '字母表',
  'US:LITE': '朗美通',
  'US:META': '元平台',
  'US:NBIS': '内比乌斯',
  'US:NOW': '服务现在',
  'US:NTAP': '网存',
  'US:P': '永纯',
  'US:PLTR': '帕兰提尔',
  'US:SNOW': '雪花',
  'US:VST': '维斯特拉',
};

export function chineseDisplayTranslation(id: string, original: string): string | undefined {
  const translated = translations[id];
  return translated && original.trim() ? `${translated}（${original.trim()}）` : undefined;
}
