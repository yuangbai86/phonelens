# 真实反馈的标注与发布流程（无需模型 API）

目标：用来源和使用范围清楚的少量真实反馈，完成“AI 提取 → 程序校验 → 人工审核 → 静态发布”。有多少就展示多少，不设条数门槛；小样本只给定性总结，不做显著性检验，不判定胜负。

## 1. 登记来源

在 `data/v1/review-sources.json` 中加一条（示例）：

```json
{
  "id": "src-self-2026-11",
  "kind": "review_source",
  "name": "本人与朋友授权的使用反馈",
  "url": null,
  "access_method": "当面或私信收集，提供者同意公开展示原文",
  "allowed_storage": "可保存于公开仓库",
  "allowed_display": "full_text",
  "collected_at": "2026-11-25",
  "verification": "unverified",
  "notes": "提供者、时间与授权方式的记录保存在仓库外"
}
```

`allowed_display` 可选 `full_text` / `excerpt` / `summary_only` / `none`；为 `none` 的来源不会写入公开数据。来自平台的评论，只有确认平台允许保存和展示后才能登记。

## 2. 在网站上清洗与标注

1. 打开 https://yuangbai86.github.io/phonelens/import/ ，选择机型，粘贴反馈或上传 CSV（模板 `data/templates/reviews_template.csv`），勾选确认。去重、广告与机型混入识别在浏览器完成。
2. 点“复制标注请求”，发给 Claude（提示词版本 `extract-v1.1`，内容见 `prompts/extract.md`）。
3. 把 Claude 回复的 JSON 粘贴回来，点“校验并导入”。程序核对：编号存在、维度与情绪合法、原文摘录逐字出现在该条反馈中、“具体问题”不超过 30 字且不含摘录里没有的数字。不合格的标签不计入，相关反馈转“待复核”；Claude 没有返回结果的反馈保持“未标注”，不当成“未提及”。
4. 人工检查定性总结与逐条结果，确认无误后点“下载校验结果（JSON）”。

## 3. 写入静态数据并发布

```bash
npx tsx scripts/import-reviewed.ts 下载的文件.json --phone apple-iphone-17-256 --source src-self-2026-11 --reviewer "审核人" --dry-run
npx tsx scripts/import-reviewed.ts 下载的文件.json --phone apple-iphone-17-256 --source src-self-2026-11 --reviewer "审核人"
npm run check
git add data/v1 && git commit -m "新增 iPhone 17 真实反馈（已审核）" && git push
```

脚本会再次核对每个标签，只追加不覆盖，重复文本自动跳过。推送到 `main` 后 GitHub Pages 自动更新。页面上这些内容标为“预先完成的 Claude 辅助标注，经人工审核”，不是访问时的实时调用。
