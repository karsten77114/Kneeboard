# DESIGN_FUSION_SJX
> 風格定位：Carbon × Apple Dark — 暖黑奢華航空儀表板
> 演進歷程：Cyber-Minimal → Starlux Fusion → **Carbon × Apple（方案D，當前）**

---

## 一、色彩系統 Color Tokens（當前實作）

> 以下為 `css/base.css` 的 CSS Custom Properties，是前端唯一真實來源。

### 1.1 背景層次（暖黑系）

| CSS Variable | Hex / 值 | 說明 |
|---|---|---|
| `--bg` | `#0d0c0b` | 最深底層背景，極深暖近黑 |
| `--bg-base` | `#181614` | 頁面中間層 |
| `--surface` | `#201e1b` | 次要 surface（卡片下層）|
| `--card` | `#2e2b26` | 卡片背景，略亮以跳出底層 |

> ⚠️ 背景已從舊版冷藍（`#0c1118 / #141c28`）全面改為暖黑。任何新元件背景不得使用冷藍系。

### 1.2 文字層次（Apple 暖灰分級）

| CSS Variable | 值 | 說明 |
|---|---|---|
| `--text` | `#f5f5f0` | Primary，稍帶暖白（Apple label-primary 風格）|
| `--text2` | `#b8b0a0` | Secondary，暖灰沙色（Apple secondaryLabel）|
| `--text3` | `rgba(184,176,160,0.50)` | Tertiary，muted，輔助說明 |

> ⚠️ 舊版次要文字 `#b8c1ec`（薰衣草藍）已廢棄，改為暖灰 `#b8b0a0`。

### 1.3 品牌金色（Starlux 繼承）

| CSS Variable | 值 | 說明 |
|---|---|---|
| `--gold` | `#c49a3c` | 主強調色，所有 active / highlight |
| `--gold-lt` | `#d4b46a` | Hover、輕點綴 |
| `--gold-dim` | `#a07c2e` | Pressed、深沉金 |
| `--gold-glow` | `rgba(196,154,60,0.30)` | 光暈 box-shadow 用 |

### 1.4 邊框（Apple hairline 風格）

| CSS Variable | 值 | 說明 |
|---|---|---|
| `--border` | `rgba(255,255,255,0.08)` | 主要分隔線、卡片邊框（白色微透）|
| `--border-dim` | `rgba(255,255,255,0.04)` | 極淡分隔線 |

> ⚠️ 舊版邊框 `rgba(196,154,60,0.12)`（金色微透）已改為 Apple 白色 hairline，更克制。

### 1.5 狀態色

| CSS Variable | Hex | 說明 |
|---|---|---|
| `--green` | `#00f5a0` | 成功、正值、準時 |
| `--amber` | `#ffb703` | 警告、延誤 |
| `--red` | `#ff4757` | 錯誤、取消 |
| `--blue` | `#60a5fa` | 資訊、連結（少用於文字）|
| `--yellow` | `#fbbf24` | 提示 |
| `--violet` | `#7b2fff` | Premium、特殊 |

### 1.6 色彩層次總覽

```
背景層：--bg (#0d0c0b) → --bg-base → --surface → --card (#2e2b26)
文字層：--text (#f5f5f0) → --text2 (#b8b0a0) → --text3 (muted)
強調色：--gold（唯一主強調）
邊框：--border（白色 hairline，Apple 風格）
狀態色：green / amber / red（不與金色混用）
```

---

## 二、Layout 背景（各固定欄位）

| 元件 | 背景值 | 說明 |
|---|---|---|
| `#topbar` | `rgba(13,12,11,0.94)` | 頂端固定列 |
| `#searchbar` | `rgba(13,12,11,0.92)` | 班號搜尋列 |
| `#tabbar` | `rgba(13,12,11,0.92)` | 底部分頁列 |
| `.sub-tabbar` | `rgba(13,12,11,0.85)` | 子分頁列（Flight Crew 內）|
| 桌機 sidebar | `rgba(13,12,11,0.92)` | 左側導覽 |
| 一般卡片 | `var(--card)` = `#2e2b26` | 內容卡片 |

> ⚠️ 所有列欄背景一律用暖黑 `rgba(13,12,11,...)` 系列。舊版冷藍 `rgba(12,17,24,...)` / `rgba(20,28,40,...)` 已全面廢棄。

---

## 三、字型系統 Typography

| 層級 | 字型 | 用途 |
|---|---|---|
| 數據 / 時間 / 代碼 | `'JetBrains Mono', 'SF Mono', monospace` | 航班號、時間、坐標、ATC Route |
| 介面標籤 / 按鈕 | `system-ui, -apple-system, sans-serif`（繼承）| 一般 UI 文字 |

> 舊版規劃的 Noto Serif TC 與 Inter 在 PWA 實作中未實際載入，目前完全使用系統字型。

### 字體大小規則（clamp 響應式）

```
ICAO code:     clamp(17px, 3.5vw, 22px)  ｜ font-weight: 800
ETE 主數字:    clamp(16px, 3.5vw, 26px)  ｜ font-weight: 800
UTC 時間:      clamp(14px, 2.8vw, 19px)  ｜ font-weight: 800, Mono
FL 標籤:       clamp(13px, 2.2vw, 17px)  ｜ font-weight: 700, Mono
副文字:        clamp(9px, 1.4vw, 13px)   ｜ color: --text2
UTC 時差 chip: clamp(8px, 1.1vw, 10px)   ｜ Mono, background chip
```

---

## 四、Topbar 元素層次

```
航班號 JX001：--gold（最顯眼）
航路 KLAX → RCTP：--text（暖白，次顯眼）
機號 B58507：--text（暖白，識別用）
日期 / 時間：--text2（暖灰，背景感）
UTC 時鐘：--text2 + --text3 label
```

---

## 五、Briefing 飛行剖面卡（arc card）

### SVG 座標系（ViewBox 0 0 500 200，preserveAspectRatio="none"）

```
比例容器：aspect-ratio: 5/2; min-height: 170px; max-height: 280px
左側落地點：x = 90  (18%)
右側落地點：x = 410 (82%)
巡航左端：  x = 200 (40%)
巡航右端：  x = 300 (60%)
地面線：    y = 148 (74%)
巡航線：    y = 45  (22.5%)
```

### 所有路徑（需同步更新）

```svg
<!-- Fill -->
<path d="M 90,148 C 125,148 165,45 200,45 L 300,45 C 335,45 375,148 410,148 L 410,200 L 90,200 Z" fill="url(#fpFill)"/>
<!-- Glow -->
<path d="M 90,148 C 125,148 165,45 200,45 L 300,45 C 335,45 375,148 410,148" stroke="#f0d080" .../>
<!-- Stroke -->
<path d="M 90,148 C 125,148 165,45 200,45 L 300,45 C 335,45 375,148 410,148" stroke="url(#fpGrad)" .../>
<!-- Ground dashes -->
<line x1="0" y1="148" x2="90" y2="148" .../>
<line x1="410" y1="148" x2="500" y2="148" .../>
<!-- Endpoint dots -->
<circle cx="90" cy="148" r="5.5" fill="#c49a3c"/>
<circle cx="410" cy="148" r="5.5" fill="#c49a3c"/>
```

> ⚠️ SVG 有 5 個獨立元素（fill/glow/stroke/dashes×2/dots×2），修改形狀時必須全部同步。

### 側邊欄規則
```css
.arc-side-l, .arc-side-r {
  position: absolute; top: 5%; width: 22%; z-index: 2;
  overflow: visible;  /* NOT hidden — widget 需要可以溢出 */
}
```

### WX Weather Widget 規則
```css
.wx-widget {
  display: block;          /* NOT inline-block or float */
  box-sizing: border-box;
  width: 100%;             /* 填滿側邊欄寬度 */
}
/* 不可用 float:right 在絕對定位窄容器內（手機上會完全消失）*/
/* 不可用 overflow:hidden / text-overflow:ellipsis（文字需完整顯示）*/
```

---

## 六、UI 元件規範

### 按鈕

```
Primary（Gold）
  背景：linear-gradient → --gold 系列
  文字：#0c1118（深色，高對比）
  圓角：8px
  光暈：0 0 16px var(--gold-glow)

Ghost / 次要
  背景：透明
  邊框：rgba(196,154,60, 0.25)
  文字：--text2
  Hover：背景 rgba(196,154,60, 0.08)
```

### 卡片

```
背景：var(--card) = #2e2b26
邊框：1px solid var(--border) = rgba(255,255,255,0.08)
圓角：12px
```

### 輸入框

```
背景：rgba(0,0,0,0.30)
邊框 - 預設：rgba(196,154,60,0.25)
邊框 - Focus：var(--gold)
文字：var(--text)
Placeholder：var(--text3)
圓角：6px
```

### Sub-tab 分頁（Flight Crew 內）

```
Active 文字：var(--gold)
Active 底線：2px solid var(--gold)
非 Active：var(--text3)
```

---

## 七、開發注意事項

### 顏色禁止使用
- ❌ 冷藍背景：`rgba(12,17,24,...)`, `rgba(20,28,40,...)`, `#0c1118`, `#141c28`（已廢棄）
- ❌ 薰衣草次要文字：`#b8c1ec`（已廢棄，改 `#b8b0a0`）
- ❌ 金色邊框：`rgba(196,154,60,0.12)` 作為 card 邊框（已改為白色 hairline）
- ❌ `var(--blue)` 用於純文字顯示（應只用於狀態/連結，不做一般文字色）

### 對齊原則
1. **Gold is the only hero** — 強調色只有金色，不與 blue/violet 共用
2. **Warm dark, not cool dark** — 所有深色背景偏暖，不偏藍
3. **Apple hairline borders** — 邊框輕薄白色透明，不是金色裝飾邊
4. **text > text2 > text3 語義** — 識別資訊用 text（暖白），輔助資訊用 text2（暖灰），說明用 text3（muted）

---

## 八、設計方案演進記錄

| 版本 | 底色 | 次要文字 | 邊框 | 更新日期 |
|---|---|---|---|---|
| Cyber-Minimal | 冷藍黑 `#0c1118` | `#b8c1ec` 薰衣草 | 金色透明 | 2026-05 前 |
| Starlux Fusion | 冷藍黑（同上）| `#b8c1ec` | 金色透明 | 2026-05-12 |
| **Carbon × Apple（當前）** | **暖黑 `#0d0c0b`** | **`#b8b0a0` 暖灰** | **白色 hairline** | **2026-05-23** |

---

*最後更新：2026-05-23（對齊 SW kneeboard-v47 實際實作）*
