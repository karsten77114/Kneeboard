# Cloud Development

Kneeboard 是靜態 PWA（根目錄 `index.html`、`js/`、`css/`、`sw.js`）加上 Cloudflare Worker（`worker/`）。此文件說明在雲端 / 獨立 clone 中如何開發與驗證。

## 需求

- Node 22（`package.json` 的 `engines` 為 `>=22`）。
- 無第三方依賴，不需要 `npm install`。
- `package.json` 為 `type: module`。

## 指令

```bash
npm run check   # 遞迴對 JS/mjs 做 node --check，並檢查本地相對 import 路徑
npm test        # node --test "worker/*.test.mjs"
```

`npm run check` 只檢查靜態 import 與相對路徑；動態 `import()`、CDN 與 bare specifier 會被忽略。不連網、不讀 secrets、不碰資料庫。`assets/vendor/` 不檢查。

## 預覽

```bash
python3 -m http.server 8000
```

開 `http://localhost:8000`。`sw.js` 在 localhost / 127.0.0.1 不快取。

## 瀏覽器驗證

- Headless browser 為選配，不是 check / test 的必要條件。
- 需要登入的真實客戶端測試（authenticated real-client tests）**尚待處理（pending）**，雲端環境目前不做。

## 安全

- Secrets 一律由環境注入（CI secrets、雲端環境變數），不 commit、不寫進 repo。
- 不複製正式環境資料到雲端或 repo。
- 本 CI 只做 check 與 test，**不部署**；發布維持既有經 Git 提交與推送的流程。

## Service worker 快取版本

改動 `PRECACHE` 內的檔案或新增 / 移除預載檔案時，需升 `sw.js` 的 `CACHE`（例如 `kneeboard-v73`），並同步更新 `js/utils.js` 的 `APP_VERSION`。
