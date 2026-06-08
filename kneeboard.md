# Kneeboard — 飛行員工作台 開發計畫

> 把每天上班要用的所有系統整合成一個介面，先從網頁版（PWA）開始，最終目標是原生 iOS/iPadOS App。

---

> [!IMPORTANT]
> **設計規範強制規則**：所有 UI 實作，**開始動工前必須先讀並套用 `DESIGN_FUSION_SJX.md`**。
> 色彩、字體、間距、元件樣式均以該文件為準，不得自行發明設計語言或沿用舊變數名稱。
> 路徑：`/Users/mac/Library/Mobile Documents/com~apple~CloudDocs/Karsten-Agent/DESIGN_FUSION_SJX.md`

---

**建立日期**：2026-04-29  
**更名**：Kneeboard → Kneeboard（2026-05-13）  
**作者**：Karsten（STARLUX 飛行員）  
**現有基礎**：
- 同事 zihchi 的「簡報箱」 https://zihchi.github.io/briefing-package/（天氣 + PIREPS 清單）
- 同事的「CrewSync」 https://crew-sync.onrender.com/main（班表同步 + FDP/休息計算 + PA 廣播詞 + 加班費）
- 自己的 JX Briefing 網頁（LIDO 資料 + Cloudflare Worker 後端）

---

## 一、產品願景

**問題**：每趟飛行前後，飛行員要開七八個不同系統（LIDO、ELB、天氣、NOTAM、公司通告…），在平板上切來切去，效率很低。

**目標**：一個 App 搞定所有飛前、飛中、飛後需要查的資訊，介面清爽、離線可用、iPhone/iPad 都好操作。

**設計原則**：
- 「給我答案，不給我原始數據」—— 資料自動整合，不要讓飛行員手動計算
- 深色主題、大字體，強光下也看得清楚
- 離線優先：起飛前預先快取，飛行途中不需網路
- 快速：從開 App 到看到今天的飛行資訊不超過 3 秒

---

## 二、參考分析：同事「簡報箱」

網址：https://zihchi.github.io/briefing-package/

這是目前最完整的參考。已有的功能如下：

### 外部連結快速入口
| 連結 | 說明 |
|------|------|
| Weathernews Flight Plan Editor | 天氣 + 飛行計畫 |
| SJX Pilot Space | 公司系統 |
| SJX ELB Fleet | 機隊 ELB 查詢 |
| Tono2 航空氣象 | 日本航空天氣 |
| LIDO Flight | 飛行計畫 |
| Skyinfo NOTAM 地圖 | 日本 NOTAM 視覺化 |

### 頁面內嵌工具（面板展開）
- **油量與加油時間** — 燃油重量/體積換算，加油時間估算
- **時間計算機** — UTC/本地時間換算、任務時間計算
- **桃機航班** — 桃園機場即時航班狀態
- **Curfew 倒數** — 機場噪音宵禁倒數計時
- **NOTAM 座標地圖** — 把 NOTAM 座標畫在地圖上
- **ICAO 低溫修正** — 冬季低溫高度修正計算
- **D-ATIS** — 機場自動終端資訊

### 外部開啟工具
- **休時計算** — 組員休息時間計算
- **除防冰 Holdovertime** — 除冰液保護時間查詢
- **換班單** — 班表更換申請
- **LIDOPRO** — 開發者工具

### 簡報檢查清單 PIREPS
- **P** – Personal equipments（Sign On、更新 App、證件）
- **I** – Information（班號、STD、飛時、巡航高度）
- **R** – Registration（機號、旅客數、油量、水量、MEL、停機位）
- **E** – Enroute Wx（出發、目的地、航路、備降天氣）
- **P** – Performance（起飛重、落地重、MEL 限制）
- **S** – Special Procedure（Crew/Aircraft/Airport/Weather/NOTAM/Fuel）
- **Fleet Notice Reviewed**
- **OFP Signed**

### 天氣工具（整合進頁面）
- Turbli 航班亂流查詢
- NOAA AWC METAR/TAF
- D-ATIS
- Windy：雷達、衛星雲圖、雲頂高度、地面風、FL390 風速
- Windy：晴空亂流（FL340 / FL390）
- 中央氣象署颱風路徑圖
- WAQI 空氣品質地圖
- JMA 天氣概況圖（朝/夜）、JMA 顯著天氣圖

---

## 二之二、參考分析：同事「CrewSync」（V8.0.26）

網址：https://crew-sync.onrender.com/main

CrewSync 是功能最完整的 STARLUX 飛行員工具，比簡報箱更深入後端整合。

### 核心特色（不需重複實作）
- **班表同步 → Google Calendar**：OAuth 連接公司班表系統，自動建立 Google Calendar 事件。這是 CrewSync 的核心，需要公司系統帳號，後端複雜，Kneeboard **不重做**。
- **Friends / Groups**：組員班表互相查看，社交功能，需要雲端後端，**不重做**。

### 值得彙整的功能

#### FDP / 休息時間計算（Rest Calc + Duty Time）⭐ 高優先
最完整的 CAR 07-02A 法規計算工具，包含：
- 機組配置（2P / 3P / 4P）
- Class 1 Bunk、機長裁量權（+2h）
- 時區差異適應條件（≥6h + >48h 停留）
- Max FDP / Max Flight Time 計算
- WOCL（02:00–05:00 當地時間）視覺時間線
- 機艙組員休息分段計算（第一段 / 交班 / 第二段）

**CAR 07-02A 重要參數**（直接寫進 Kneeboard）：
| 配置 | 最大 FDP | 最大飛行時間 |
|------|---------|------------|
| 2P（單組）| 14h | 10h |
| 3P（加強）| 18h | 12h |
| 4P（雙組）| 24h | 12h |
- 7 天最低休息：30h
- 連續 WOCL 2 天 → 34h 休息；3 天 → 54h 休息

#### PA 廣播詞模板（PA Script）⭐ 高優先
飛行中常用的廣播詞範本，含：
- Welcome（歡迎登機）
- Ground Delay（地面延誤）
- Descent（下降廣播）
- Turbulence（亂流 MOD / SEV / CAT）
- De/Anti-ice（除冰 / 防冰）
- Missed Approach（重飛）
- Diversion（轉降）
- Unruly Pax（不服從旅客）
- 溫度 °C ↔ °F 自動帶入廣播詞
- 目的地當地時間自動填入

#### 加班費計算（Overtime）⭐ 中優先
- 輸入表定 vs. 實際關艙 / 著陸時間
- 計算是否超過加班門檻
- 可從班表自動帶入表定時間

#### 閘門 / 停機位資訊（Gate Info）⭐ 中優先
桃園機場即時：
- 閘門號、登機櫃台、停泊位置、行李轉盤
- 表定 vs. 實際起降時間
- 按時間區間篩選（每 6 小時一格）

#### 即時航班追蹤（Live）⭐ 低優先
- 全公司航班即時位置（地圖）
- JX 航班篩選
- 機場快速跳轉

#### 簡報填寫表單（Briefing Form）⭐ 中優先
- 出發日期 / 時間、起降機場、閘門、巡航高度
- POB 自動加總（Crew + Pax = People on Board）
- 亂流、MEL、燃油、最低用水量備忘
- 航班資訊從班表自動帶入

---

## 三、Kneeboard 的差異化與新增功能

同事的簡報箱已經很好，Kneeboard 的目標不是從零開始，而是：

1. **深度整合 LIDO 資料**（同事的頁面只有快速連結，沒有直接顯示 OFP 數據）
2. **打磨成 PWA**，可離線使用，不依賴網路
3. **個人飛行記錄**（logbook + 資格追蹤）
4. **最終成為原生 iOS App**，享有 Widget / Live Activity / Siri

### 「照抄 + 改良」清單（從簡報箱借鑑）
| 功能 | 借鑑方式 |
|------|---------|
| PIREPS 檢查清單 | 完整移植，加入自動勾選（從 LIDO 帶入數據）|
| Curfew 倒數 | 移植，加入多機場設定 |
| ICAO 低溫修正 | 移植，加入公式說明 |
| 除防冰 Holdovertime | 移植 |
| 休時計算 | 移植，整合進工具頁 |
| 天氣整合 | 借鑑 Windy iframe 概念，加入自動帶入出/目的地 |
| NOTAM 地圖 | 借鑑，加入自動帶入本次飛行機場 |

### Kneeboard 獨有功能
- LIDO OFP 數據直接顯示（燃油、重量、路線等，非只是連結）
- ELB MEL 狀態直接整合（非只是連結到 ELB 網站）
- 個人飛行記錄 + 資格貨幣追蹤（90天起降、ILS 次數等）
- 班表整合（若能取得 API）
- PWA 離線支援（Service Worker 快取今日資料）
- iOS 原生 App（未來）

---

## 四、功能模組完整規格

### 模組 0：首頁 / 儀表板
- 今日飛行班次摘要（班號、起降時刻、機型、機場）
- 快速狀態燈：簡報 ✓ / MEL ✓ / 天氣 ✓
- PIREPS 檢查清單（最重要的功能，放首頁最顯眼）
- 距離下一班飛行倒數
- Curfew 倒數（常用機場）

**路線感知智能 Checklist**（來自 Gemini 建議，⭐ 採納）：
根據目的地自動追加額外提醒項目：
| 航線 | 自動追加提醒 |
|------|------------|
| 日本 | Tono2 天氣確認、日本 NOTAM 地圖 |
| 美線 | CANP 文件、Pacific HF 頻率、MNPS 資格確認 |
| 東南亞 | 各國入境文件、低溫修正（KUL 例外）|
| 港澳 | RNP 授權確認 |

---

### 模組 1：飛行簡報（LIDO OFP）
**資料來源**：LIDO via Cloudflare Worker proxy

**顯示內容**（來自現有 JX Briefing）：
- 航班號、起降機場、日期
- STD / STA（UTC + 當地時間）、飛行時間（ETE）
- 飛行距離（NM）、Wind Component
- 備降場（ALTN）+ 備降燃油
- 燃油計畫：Trip / Alternate / Final Reserve / Contingency / Extra / Takeoff Fuel
- 重量：ZFW / TOW / LDW（含 % of limit 視覺化進度條）
- ATC Clearance Route

**新增**：
- 多航段（同一天 A→B→C）
- OFP 備忘欄位（Remarks 手動記錄）
- 離線快取（Service Worker，飛行前下載好）
- PDF 截圖匯出

---

### 模組 2：飛機狀態（ELB）
**資料來源**：ELB WebSocket（via Cloudflare Worker proxy）

**功能**：
- 機隊清單（A321 / A330 / A350）
- 今日飛機的 MEL Deferred Defects
- 最近飛行記錄
- MEL 狀態標示（0 defects = 綠色，有 MEL = 黃色）

---

### 模組 3：天氣（整合式）
**資料來源**：Windy iframe + AVWX API + NOAA + JMA

**METAR / TAF 面板**：
- 出發地 + 目的地 + 備降場（自動從簡報帶入）
- 能見度 / 雲底 / 風向風速
- TAF 24 小時趨勢（文字 + 視覺化）

**圖形天氣（嵌入 iframe）**：
- 雷達回波（Windy）
- 衛星雲圖（Windy）
- 高空風（FL390）
- 晴空亂流（FL340 / FL390）
- 颱風路徑（中央氣象署）
- 顯著天氣圖（JMA SIGWX）
- Turbli 亂流查詢

**特殊天氣工具**：
- D-ATIS 快速查詢
- ICAO 低溫修正計算（冬季）
- 除防冰 Holdovertime 查詢

---

### 模組 4：NOTAM
**資料來源**：ICAO NOTAMam 或 FAA NOTAM API + NOTAM 座標地圖

**功能**：
- 機場 NOTAM 查詢（自動帶入出發/目的地）
- 日本 NOTAM 地圖（Skyinfo）
- 標記已讀，下次高亮新增項目

---

### 模組 5：計算工具箱

**FDP / 休息計算（來自 CrewSync，⭐ 最重要）**：
- 機組配置（2P / 3P / 4P）+ Class 1 Bunk
- Max FDP / Max Flight Time 截止時間
- 機長裁量權（+2h）開關
- 時區差異適應條件（≥6h + >48h 停留）
- WOCL（02:00–05:00 當地時間）視覺時間線
- 連續 WOCL 天數處罰計算
- 機艙組員分段休息計算（第一段 / 交班 / 第二段）
- CAR 07-02A 法規速查表（2P/3P/4P 上限一覽）

**加班費計算（來自 CrewSync）**：
- 表定 vs. 實際 Block time 對比
- 超時門檻計算

**PA 廣播詞（主體來自自己的 Flight PA App + 補充 CrewSync 沒做的情境）**：
- 基礎架構：直接移植 `FlightPAManager.swift` + `AirportManager.swift` + `Airports.json`（32 個 STARLUX 航點含中文名）
- ✅ 已有：Departure（起飛前）、Descent（下降前），中英雙語同時輸出
- ✅ 已有：時差計算、Zulu → 當地時間轉換、°C ↔ °F 自動帶入
- ➕ 需補：Ground Delay（地面延誤）
- ➕ 需補：Turbulence（亂流 MOD / SEV / CAT）
- ➕ 需補：De/Anti-ice（除冰 / 防冰）
- ➕ 需補：Missed Approach（重飛）
- ➕ 需補：Diversion（轉降）
- ➕ 需補：Unruly Pax（不服從旅客）

**時間工具**：
- UTC ↔ 當地時間換算（台灣 / 日本 / 東南亞常用時區）
- 任務時間計算（Block time、Duty time）
- Curfew 倒數（多機場）

**航空計算**：
- 燃油換算（kg ↔ lbs ↔ Liters，依機型密度換算）
- 加油時間估算（流量 + 目標加油量）
- ICAO 低溫修正（Altitude correction，含 ICAO Doc 8168 修正量表）
- 除防冰 Holdovertime 查詢
- 橫風分量（Crosswind Component）
- Top of Descent（3° / 3.5° glidepath）

**單位換算**：
- 重量：kg ↔ lbs ↔ MT
- 壓力：hPa ↔ inHg
- 溫度：°C ↔ °F
- 距離：NM ↔ km

---

### 模組 6：資格追蹤（Currency Dashboard）

> **設計決策**：Karsten 已在使用 **Log ATP 2**（iOS App）和 iCloud 上的 **Numbers「Pilot Logbook」** 管理飛行記錄，Kneeboard **不重複做 Logbook 功能**，改專注在「快速看我現在資格夠不夠」的儀表板。

**定位**：不是 Logbook，是每次報到前 30 秒掃一眼的「資格紅綠燈」

**核心顯示**：
- 90 天 3 次起降 → 距到期剩幾天（🟢 充裕 / 🟡 30 天內 / 🔴 7 天內）
- ILS 近場次數（過去 6 個月）
- 最後一次 PIC 飛行日期
- 年度體檢到期日
- 護照有效期（常飛日本/東南亞）

**資料輸入方式**（三選一，未來再決定）：

**選項 A — 手動輸入關鍵數字（最快）**  
只填「上次起降日期 + 次數」和「ILS 次數」，其他自動算。適合 Phase 1 快速上線。

**選項 B — 讀取 iCloud Numbers 檔案**（✅ 已驗證可行，建議路線）  
透過 `numbers-parser`（網頁/Python 後端）或 iOS Files API 讀取 "Pilot Logbook" Numbers 檔，解析後自動更新儀表板。

已確認的 Numbers 欄位對應（SJX 分頁）：
| 欄 | 欄位名稱 | 說明 |
|----|---------|------|
| A | DATE | 飛行日期 |
| B | AIRCRAFT TYPE | 機型（A321-252NX 等）|
| C | REGISTRATION | 機尾號 |
| D | PIC | 機長姓名 |
| E | FLIGHT No. | 班號 |
| F | FROM | 出發地（IATA）|
| G | TO | 目的地（IATA）|
| H | Block Out (UTC) | 離廊橋時間 |
| I | T/O Time (UTC) | 起飛時間 |
| J | LDG Time (UTC) | 落地時間 |
| K | Block In (UTC) | 進廊橋時間 |
| L | APPROACH TYPE | 近場類型（ILS / RNP 等）|
| M | T/O count | 起飛次數（1 or 空）|
| N | LDG count | 落地次數（1 or 空）|
| O | Flight Time | **Takeoff → Landing**（輪子離地到接地，非正式飛時）|
| P | Total Duration of Flight | **Block Out → Block In**（正式飛行時數，用這個）|

Summary 分頁直接存有各機型累計 Block time，讀這個最準確（不需重算）。

**選項 C — Log ATP 2 匯出 CSV**  
Log ATP 2 支援匯出 CSV / EASA 格式，導入後一次性更新，之後每月一次。

**建議路線**：Phase 1 網頁版用選項 A（手動，最快），iOS App 版用選項 B（直接讀 iCloud Numbers）。

---

### 模組 7：閘門 / 停機位（Gate Info）
**來源**：桃園機場即時資料（CrewSync 已有，借鑑）

- 閘門號、登機櫃台、停泊位置、行李轉盤
- 表定 vs. 實際起降時間
- 按時間區間篩選（每 6 小時）
- JX / BR / CI 航空公司篩選

---

### 模組 8：快速入口（Links Hub）
- SJX Pilot Space
- LIDO Flight（直接連結，若未登入則跳登入）
- SJX ELB Fleet
- Weathernews Flight Plan Editor
- Tono2 日本航空天氣
- GPS 干擾區域查詢
- 颱風路徑圖（中央氣象署）
- Pacific HF 無線電頻率表（長途航線）
- FR24 即時航班追蹤
- 桃機航班查詢
- 換班單

---

## 五、技術架構

### Phase 1：PWA 網頁版

**已確認技術決策（2026-05-13）**：
- 前端：**Vanilla JS**，無 Vite / 無框架，ES Modules 靠 `<script type="module">` 原生支援
- 程式碼：**全新專案**（乾淨資料夾結構），再把 JX Briefing 現有 LIDO 查詢邏輯移植進來
- 後端：**全部集中 Cloudflare Workers**（現有 Worker 延伸，不開新服務）
- 離線：Service Worker + Cache API（快取今日 OFP + METAR）
- 安裝：PWA manifest → 加到 iPad/iPhone 主畫面
- 資料：IndexedDB（OFP + 天氣快取）+ localStorage（使用者設定 / 登入 session token）

**天氣系統架構決策（2026-05-14）**：
- LIDO 回傳的機場代碼是 **IATA 三字碼**（LAX、TPE），NOAA 需要 **ICAO 四字碼**（KLAX、RCTP）→ 所有天氣 API 呼叫前必須先過 `toICAO()`（定義於 `js/utils.js`）
- 天氣資料統一存放在 **`store.wxData`**（跨模組共用快取），不得各模組各自維護私有快取
- 天氣在**載入 Briefing 時即於背景預載**（`preloadMetarForFlight()`），不等使用者點 Weather 分頁
- Worker 天氣端點為 **NOAA proxy**（非 AVWX），路徑：`/api/weather/metar`

**Weather 分頁實作決策（2026-05-14）**：
- WX Chart 子頁已改名為 **OFP Charts**，資料來自 Worker `/charts`、`/chart` 端點（非 Windy iframe）
- METAR 卡片使用 **NATO 氣象色碼**（VFR / MVFR / IFR / LIFR），依能見度與雲底高度判斷
- **D-ATIS 子頁只顯示 ATIS 本文**，過濾掉 METAR / TAF 區段（PlanFlight 開發時已確認，嚴格執行，不得改動）

**Topbar 時間顯示規則**：
- `f.std` / `f.sta` 從 Worker 回傳時已含 `Z` 後綴（如 `"1730Z"`），app.js **不得再附加 `Z`**，否則顯示成 `"1730ZZ"`

**本地開發環境**：
- Dev server：`cd .../Kneeboard && python3 -m http.server 7788`
- Worker base URL：`https://jx-briefing.karsten77114.workers.dev`
- `preview_start` 工具在 worktree 環境下失效，必須改用 Bash 直接啟動 server
- Service Worker 版本目前為 `kneeboard-v10`，每次 major deploy 前須手動 bump 版號

**Cloudflare Worker 端點規劃**：
```
POST /auth/lido          → LIDO 登入（現有，保留）
GET  /api/briefing       → LIDO OFP 數據（現有，保留）
POST /auth/elb           → ELB 登入（新增）
GET  /api/elb/aircraft   → 單一飛機 MEL + 飛行記錄（新增）
GET  /api/weather/metar  → AVWX METAR/TAF proxy（新增）
GET  /api/notam          → ICAO NOTAM proxy（新增）
GET  /api/gate           → 桃機閘門資訊（新增）
```

**專案資料夾結構**：
```
planflight/
├── index.html
├── manifest.json
├── sw.js                    → Service Worker
├── css/
│   ├── base.css             → 設計系統（顏色、字體、共用元件）
│   └── layout.css           → Tab Bar、頂部資訊列佈局
├── js/
│   ├── app.js               → 進入點，Tab 切換 router
│   ├── store.js             → 全域狀態（已選航班、登入狀態）
│   ├── views/
│   │   ├── home.js          → 主畫面（連線中心 + 搜尋 + PIREPS）
│   │   ├── flightcrew.js    → Flight Crew 子頁面切換
│   │   ├── fc-briefing.js   → 2-1 Briefing
│   │   ├── fc-elb.js        → 2-2 ELB
│   │   ├── fc-weather.js    → 2-3 Weather
│   │   ├── fc-notam.js      → 2-4 NOTAM on Map
│   │   ├── fc-gate.js       → 2-5 Gate Info
│   │   ├── pa.js            → PA 廣播詞
│   │   └── tools.js         → 計算工具集
│   └── services/
│       ├── api.js           → Cloudflare Worker 呼叫封裝
│       ├── cache.js         → IndexedDB 讀寫
│       └── storage.js       → localStorage（設定 / token）
└── assets/
    └── airports.json        → 32 個 STARLUX 航點（從 PA App 移植）
```

---

### Phase 2：原生 iOS/iPadOS App（SwiftUI）

```
架構：MVVM + SwiftData
UI：SwiftUI（iPhone + iPad 自適應）
離線：SwiftData 本地快取 + Background App Refresh
認證：Keychain
通知：UNUserNotificationCenter（飛前提醒、Curfew 警告）
Widget：WidgetKit（今日航班、天氣、貨幣倒數）
Live Activity：飛行進度（起飛到降落的即時倒數）
```

---

## 六、開發路線圖

### 🟢 Phase 1a：PWA 骨架（已完成）

- [x] PWA manifest + Service Worker 基礎（v10）
- [x] 底部導覽列 HTML/CSS 骨架
- [x] 移植 JX Briefing LIDO 查詢
- [x] ELB 查詢整合
- [x] 設計系統：DESIGN_FUSION_SJX 全面套用（base.css / layout.css 完整重寫）

---

### 🟢 Phase 1b：核心功能（已完成）
- [x] LIDO OFP 資料顯示（燃油、重量、路線、stats strip）
- [x] ELB MEL 狀態整合
- [x] 離線快取機制（Service Worker）

---

### 🟢 Phase 1c：天氣完整版（已完成 2026-05-14）
- [x] METAR/TAF 自動帶入出發/目的地/備降（IATA→ICAO 自動轉換）
- [x] Briefing 載入時背景預載天氣（preloadMetarForFlight）
- [x] AeroWeather 卡片 + NATO 氣象色碼（VFR/MVFR/IFR/LIFR）
- [x] OFP Charts 圖表檢視器（Worker `/charts` 端點）
- [x] D-ATIS 只顯示 ATIS 本文（過濾 METAR/TAF）
- [x] JMA 顯著天氣圖 + 颱風路徑嵌入（SIGWX/TC 子頁：JMA SIGWX 圖、地面天氣圖、CWA 颱風 iframe）
- [x] Turbli 亂流查詢整合（嵌入式 iframe 切換 + 外部開啟雙模式）
- [x] NOTAM 座標地圖（fc-notam.js 全面重寫：Skyinfo iframe + 自動帶入機場 + 查詢子頁）

---

### 🟢 Phase 1d：個人 Logbook（1-2 週）
- [ ] 飛行記錄新增/編輯（表單設計）
- [ ] 資格貨幣追蹤（90天起降倒數）
- [ ] 統計儀表板

---

### 🔵 Phase 2：iOS 原生 App（4-8 週）
- [ ] SwiftUI 專案架構（MVVM + SwiftData）
- [ ] 移植所有 Phase 1 功能
- [ ] iPad 雙欄佈局 + Split View（左側 PDF 手冊、右側工具）
- [ ] WidgetKit（今日航班、資格倒數、Curfew 倒數）
- [ ] Live Activity（飛行進度）
- [ ] Background Tasks（清晨自動同步 OFP + METAR，起床即有最新資料）

---

## 七、設計規範

> **⚠️ 此節為舊版速查參考，實際開發以 `DESIGN_FUSION_SJX.md` 為唯一準則。**
> 凡與下列舊變數有衝突，一律以 DESIGN_FUSION_SJX.md 為準。

### 行動裝置 / 平板 UI 規則（強制，所有頁面均適用）

> [!IMPORTANT]
> 這組規則與 DESIGN_FUSION_SJX.md 同等強制，適用於所有 UI 實作。

#### 觸控目標大小
- 所有可點擊元素（按鈕、Tab、展開箭頭）**最小 44×44 pt**，符合 Apple HIG 標準
- 表單 input 最小高度 44px，內距 `padding: 9px 12px` 以上
- 密集資訊區（如燃油列表）的列高不得低於 36px

#### 滾動最小化原則
- 同一語意單元的相鄰卡片，**優先使用 2 欄 grid 並排**，而非上下堆疊
- 天氣、閘門等「需並排比較」的資訊，使用 `.grid2f`（強制 2 欄，不隨螢幕寬度折疊）
- 可選擇性閱讀的大型區塊（客艙簡報表單、MEL 明細）預設**摺疊（collapsed）**，點擊標題展開
- 盡量讓「最高頻使用資訊」（飛行弧、燃油 TOF、重量、天氣）不需捲動即可看到

#### 響應式斷點行為
- `≥768px`（iPad）：使用 `.grid2` / `.grid3`，充分利用寬螢幕
- `<768px`（iPhone）：`.grid2` 自動折為單欄；若需強制 2 欄請用 `.grid2f`
- 字體大小不得小於 11px（可讀性底線）；關鍵數值（時刻、油量）至少 14px

#### 字體與 monospace
- 數值型資料（時刻、油量 kg、FL、距離 NM）一律使用 `'JetBrains Mono', 'SF Mono', monospace`
- 中英文標籤使用系統字體 `-apple-system, BlinkMacSystemFont`

#### 卡片設計
- 卡片間距 `gap: 10px`，內距 `padding: 14–16px`
- 卡片標題（`card-title`）同行右側可放置狀態 badge，節省垂直空間

### 配色（沿用 JX Briefing 深色主題）
```css
--bg:      #070c14   /* 主背景 */
--surface: #0f1824   /* 卡片底色 */
--card:    #162030   /* 次級卡片 */
--border:  #1e3050   /* 分隔線 */
--accent:  #f59e0b   /* 琥珀金（強調、重要數值）*/
--blue:    #60a5fa   /* 資訊、路線 */
--green:   #22c55e   /* 正常、安全 */
--red:     #ef4444   /* 警告、超限 */
--text:    #e2e8f0   /* 主文字 */
--text2:   #94a3b8   /* 次要文字 */
--text3:   #475569   /* 說明文字 */
```

### 頂部固定航班資訊列
永遠顯示目前已選取航班的核心資訊，不隨頁面捲動消失：
```
[JX725]  TPE → KUL  |  STD 11:15  STA 15:30  |  B-58301  |  ETE 4h15m
```
- 航班未選取時顯示：「尚未選擇航班 — 請先查詢」
- iOS 實作：放在 `safeAreaInsets.top` 下方的固定 `HStack`

### 導覽結構（底部 Tab Bar，4 個主 Tab）
```
[🏠 主畫面]  [✈️ Flight Crew]  [🎙 PA]  [🔧 Tools]
```

#### Tab 1 — 主畫面
- 連線中心：LIDO / ELB / WNI 登入狀態燈（含上次登入時間，session 過期主動提醒）
- 航班搜尋
- PIREPS 飛行前檢查（資料自動帶入 + 飛行員手動逐項確認勾選）
  - 每個 PIREP 項目可點擊跳轉至對應的 Flight Crew 子頁面

#### Tab 2 — Flight Crew
- **2-1 Briefing**：LIDO OFP 資料 + 飛機 MEL 自動帶入
- **2-2 ELB**：自動帶入已查詢航班飛機 + 過去 5 天歷史記錄
- **2-3 Weather**：METAR/TAF · D-ATIS · WX Chart · Cold Temp · Turbli（同頁內 Segmented Control 切換）
- **2-4 NOTAM on Map**：自動帶入本次飛行機場
- **2-5 Gate Info**：桃機閘門/停機位/行李轉盤即時資訊

#### Tab 3 — PA
- 廣播詞模板（起飛前、下降前、地面延誤、亂流、除防冰、重飛、轉降、不服從旅客）
- 溫度 °C ↔ °F、當地時間自動帶入

#### Tab 4 — Tools
- **4-1 FDP**：法規工時計算（CAR 07-02A，2P/3P/4P）
- **4-2 Overtime**：加班費計算
- **4-3 Pacific HF**：太平洋無線電頻率表
- **4-4 計算工具**：燃油換算、時間計算、Curfew 倒數、低溫修正、Holdovertime、橫風分量、TOD
- **4-5 外部連結入口**：SJX Pilot Space、LIDO、ELB Fleet、WNI、Tono2、FR24、換班單等

### RWD 斷點
- `< 600px`：iPhone，單欄，底部 Tab
- `600-1024px`：iPad 直向，底部 Tab + 較寬卡片
- `> 1024px`：iPad 橫向，左側 Sidebar 導覽 + 右側主內容

---

## 八、相關資源

| 資源 | 說明 |
|------|------|
| https://zihchi.github.io/briefing-package/ | 同事簡報箱（最重要參考） |
| `200_Reference/Dev/Flight PA.swiftpm/` | PA 廣播詞 App（SwiftUI，已有 Departure + Descent 中英雙語）|
| `200_Reference/Dev/PlanFlight/` | PlanFlight 已歸檔（前身，2026-05-29）。核心功能已整合至 Kneeboard |
| `https://jx-briefing.karsten77114.workers.dev` | Cloudflare Worker 後端 |
| https://avwx.rest | 天氣 API（METAR/TAF），API Key 存於 memory/reference_avwx.md |
| https://www.windy.com | 天氣視覺化（iframe 嵌入）|

---

## 九、各系統帳號說明

每個系統的帳密**完全獨立**，使用者需分別設定：

| 系統 | 帳密類型 | 用途 | 是否需要 |
|------|---------|------|---------|
| **LIDO** | LIDO 專屬帳號 | 飛行簡報 OFP 查詢 | ✅ 必要 |
| **ELB** | ELB 專屬帳號（≠ LIDO）| MEL / 飛行記錄查詢 | ✅ 必要 |
| **JX Crew / Pilot Space** | 公司 SSO 帳號 | 班表、公司通告 | ✅ 必要（外部連結）|
| **WNI FPL Editor** | Weathernews 帳號 | 飛行計畫天氣 | ❓ 待確認是否整合 |
| **AVWX** | API Key（已取得）| METAR/TAF 天氣 | ✅ 已設定，後端使用 |
| **Windy** | 無需帳號 | iframe 天氣圖 | ✅ 免登入 |
| **ICAO/FAA NOTAM** | 無需帳號 | NOTAM 查詢 | ✅ 免登入 |

**設計原則**：各系統帳密各自儲存（Keychain / localStorage），App 內分別設定，不互相干擾。

---

## 十、下一步行動（開新對話前確認）

1. **確認 Phase 1a 框架**：純 HTML + Vanilla JS（最快上手）還是 Vite（開發體驗更好）？
2. **Cloudflare Worker 擴充**：加 ELB proxy 端點（帳密與 LIDO 分開處理）
3. **確認 WNI FPL Editor**：是否要整合，還是只放外部連結即可？
4. **決定 Logbook 資料格式**：localStorage JSON schema 設計

---

## 十一、待辦（來自 CrewSync 觀察，2026-05-13）

- [ ] **Offline-first + 可選雲端同步**：本機先存、登入後才跨裝置同步。登入前明確顯示「目前僅本機儲存」狀態提示，降低新用戶門檻。（對應現有設計原則「離線優先」，需落實為具體 UI 提示與 Service Worker 策略）
- [ ] **版本號常駐顯示**：在 App 某固定角落（建議右下角或設定頁底部）顯示目前版本號（如 `V1.0.3`），方便飛行員回報問題時確認版本。
- [ ] **雙語 UI（中 + 英）**：所有關鍵標籤保留中英對照（如「查詢 Query」「重設 Reset」「已登入 Signed In」），方便外籍機組或英語環境使用。需決定: 是否要做完整 i18n，或只做重要操作標籤的雙語標注即可。

- [ ] **WNI FPE 天氣圖整合（ICAO FPL 格式）**：WNI Flight Plan Editor（https://flight-plan-editor.weathernews.com/flight_plan_editor/#login）需貼入完整 ICAO FPL 括弧格式取得天氣圖。LIDO OFP 的 ATS 欄位包含完整 `(FPL-SJX...-...-...-...-...)` 括弧區塊。TODO：解析 OFP 文字抓出此區塊，在天氣頁提供「複製 FPL」按鈕，讓使用者一鍵貼入 WNI 網站，自動帶入航路與機型等資訊。
- [ ] **機位自動查詢並帶入客艙簡報**：查詢當班航班的閘門（Gate）與停機位資訊後，自動填入客艙組員簡報表單的「Dep Gate」與「Arr Gate」欄位，無需手動輸入。需確認資料來源（桃機 API / 公司 DCS 系統）及授權方式。

### 許願清單（目前不開發，未來視需求加入）

- 🔮 **資格紅綠燈 Currency Dashboard**：90 天起降倒數、ILS 次數、體檢到期日等合規狀態一覽。等 Phase 2 iOS 原生 App 階段再評估，可串接 iCloud Numbers Logbook 自動計算。
