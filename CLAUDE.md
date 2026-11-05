# Claude Project Entry

可在獨立 clone（含雲端）使用。

Read first:

1. `.agent-project.yml`（必讀）。
2. `CLOUD_DEVELOPMENT.md`。
3. 選讀：若存在 `../../../PROJECT_CONTEXT.md`、`../../../000_Agent/AGENT_ROUTING.md`、`../../../000_Agent/memory/MEMORY.md`，以及 `.agent-project.yml` 列出的 memory，就讀；不存在就略過。

Rules:

- 在此資料夾工作；commit / push 前確認 Git 根目錄。
- 驗證：`npm run check`、`npm test`（Node 22）；預覽 `python3 -m http.server 8000`。
- 繁體中文，中英文與數字間加半形空格，簡潔。
- 不寫 secrets、不 commit 憑證、不複製正式資料；不從 CI 部署。
- 改 `sw.js` 的 `PRECACHE` 或預載檔案，必須升 `CACHE`（`kneeboard-vNN`）並同步 `js/utils.js` 的 `APP_VERSION`。
- Claude 優先實作，Codex 審查；雲端沒有 wrapper 時由當前 agent 直接完成。
- AGY 僅用於跨模型第二意見或使用者明確指定。
- 若上層共享 memory 存在，有重要決策才更新 `../../../000_Agent/memory/`（可用 `/recap`）；獨立 clone 不需要。
