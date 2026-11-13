# 備忘錄公告處理契約

使用者說「處理公告」時，來源是 Apple 備忘錄：iCloud → ✈️ Pilot → SJX Bulletin。
已確認 note ID：981A7BC4-CE8E-45C6-8067-B542AD4911F2。
這是一則固定收件備忘錄，不是資料夾。保留標題與備忘錄本身，只在上架並讀回驗證成功後移除對應的已處理內文或附件。失敗、不清楚與處理中新增的內容保留。不呼叫外部 AI API。

## 匯入 API

`POST /api/notices/import`，與既有上傳相同的 Bearer `UPLOAD_TOKEN` 認證。

Request JSON：

```json
{
  "notice": {
    "title": "公告標題",
    "issue_date": "2026-11-14",
    "effective_date": null,
    "source": "FN-26-0000",
    "source_tag": "fleet_notice",
    "tags": ["ops"],
    "aircraft": ["all"],
    "urgency": "normal",
    "summary": ["供飛行員閱讀的重點，保留條件、數值與適用對象。"],
    "action_required": "知悉即可",
    "raw_text": "可選的原文節錄"
  },
  "provenance": {
    "kind": "apple_notes",
    "note_id": "981A7BC4-CE8E-45C6-8067-B542AD4911F2",
    "item_id": "text:sha256 或真實附件 ID",
    "sha256": "64 個小寫十六進位字元",
    "filename": "原始附件名稱或文字節錄名稱.txt"
  }
}
```

- 不執行任何模型或外部 fetch。僅接受經代理讀過原文、核對過的結構化結果。
- title/source 為非空字串；日期只接受實際有效的 YYYY-MM-DD 或 null；source_tag 只接受 fleet_notice/message/email；tags 為 ops/safety/manual_update/admin/app_notice 的非空陣列；aircraft 為 a321/a330/a350/all（可接受大寫並轉小寫）；urgency 只接受 normal/important/urgent；summary 為 1–7 條非空且不重複的字串。保留原文技術條件，不由 API 代寫摘要。
- 不接受 caller 指定 id/created_at 等管理欄位。provenance.kind 必須 apple_notes、note_id/item_id/filename 必須非空有限長字串、filename 不能含路徑分隔符，sha256 必須符合格式。
- 實際匯入需要 NOTICES_KV，缺少時明確失敗；來源 hash 已存在則回 action=duplicate，使用既有 notice_id，不新增或改寫；否則依既有 fingerprint 判斷更新／新增，保留原 id/created_at，記錄 updated_at 和 _source=provenance。
- 仍沿用既有最多 200 筆公告的儲存規則。
- `?dry_run=true` 只驗證並回 preview，不讀寫 KV、saved=false、dry_run=true；這不是發布成功。
- 正式成功回 ok=true/saved=true/action/notice_id/notice_issue_date/total/message，並且可從 GET /api/notices 讀回該 id 與 _source.sha256。JSON 格式錯誤或 schema 不符回 400，認證失敗回 401，儲存失敗回 500/503；訊息必須人類可讀。

## 本機發布工具

`scripts/import_notice.py --input <notice.json> --source-file <原始附件或文字節錄> --note-id <真實 note ID> --item-id <真實來源項目 ID>`

- --input 只放 notice 物件，不含秘密；--source-file 由原始備忘錄附件匯出或逐字保存正文，工具對 bytes 算 SHA-256，組 provenance。
- 憑證優先讀環境 JX_BRIEFING_UPLOAD_TOKEN / UPLOAD_TOKEN，否則從上層共享 secrets.env 只取 JX_BRIEFING_UPLOAD_TOKEN；不得輸出或存入 receipt。
- 先 POST，再輪詢 GET /api/notices 直到 id 與 _source.sha256 同時匹配（預設最多 90 秒）。未驗證成功 exit 非 0，絕不能讓代理清來源。
- 寫入私人 receipt（預設 ~/.local/share/karsten-agent/kneeboard/import-receipts/<sha256>.json，目錄 700 / 檔案 600），包含 notice_id、來源 note/item/hash、查驗時間與 action，無 token。只有 verified=true 才 exit 0。
- 如來源 bytes 在發布至驗證期間改變，不清來源且 exit 非 0。
- 工具本身不操控備忘錄、不刪檔、不建立收件資料夾。清理只由代理透過原生備忘錄介面，逐項核對後執行。
