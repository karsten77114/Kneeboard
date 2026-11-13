# Project Agent Entry

Kneeboard repo 的 agent 入口，可在獨立 clone（含雲端）直接使用。

## Read First

1. `.agent-project.yml`（必讀）。
2. `CLOUD_DEVELOPMENT.md`（指令、環境、安全）。
3. 選讀：若上層 Karsten-Agent 存在，可再讀 `../../../PROJECT_CONTEXT.md`、`../../../000_Agent/AGENT_ROUTING.md`、`../../../000_Agent/memory/MEMORY.md` 與 `.agent-project.yml` 列出的 memory。不存在就略過，不要因此中斷。

## Working Rules

- 以此資料夾為 Git 根目錄；commit / push 前用 `git rev-parse --show-toplevel` 確認。
- 驗證：`npm run check`、`npm test`（Node 22）；預覽用 `python3 -m http.server 8000`。
- 不寫入 secrets、不 commit 憑證、不複製正式環境資料；secrets 由環境注入。
- 不從 CI 部署。
- 跨專案（如 Logbook）透過上層 `100_Todo/plans/` 的共用 spec 協調；獨立 clone 中沒有就在 PR / issue 說明。

## 中文排版

- 繁體中文；中英文、中文與數字之間加半形空格（如「升 SW v73」）。
- 簡潔、直接，不寫空話。

## Service Worker 快取版本

- 改動 `sw.js` 的 `PRECACHE` 內容，或任何會被預載的檔案，必須升 `CACHE`（`kneeboard-vNN`）。
- 同時更新 `js/utils.js` 的 `APP_VERSION`，兩者保持一致。

## 實作與審查

- Claude 優先負責實作；Codex 負責審查與最終整合。
- 雲端若沒有 wrapper 或 `ai_workers` 之類工具，直接由當前 agent 完成，不要因此卡住。
- AGY 僅用於跨模型第二意見或使用者明確指定，不用於一般平行掃描。
- 審查者實際跑 `npm run check` 與 `npm test`；不要把未驗證的事稱為已驗證。

## SJX Bulletin 公告收件

- 使用者說「處理公告」時，來源是 iCloud 備忘錄 `✈️ Pilot / SJX Bulletin`，不是新資料夾。
- 先讀 `../../../000_Agent/skills/kneeboard-notice-inbox/SKILL.md`；獨立 clone 沒有此檔時，讀 `docs/NOTICE_IMPORT.md`。
- 直接由目前代理讀原文、整理，使用 `scripts/import_notice.py` 上架，不呼叫 Gemini API。只有讀回核對成功，才透過原生備忘錄介面移除對應已處理內容；保留 SJX Bulletin 備忘錄本身及標題。
