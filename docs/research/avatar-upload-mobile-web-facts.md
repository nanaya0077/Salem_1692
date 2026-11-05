# 移动端头像上传的一手事实（昵称/头像特性前置研究）

> 状态：research 完成。为「用户可改昵称与头像、支持从手机相册选图」这个特性提供实现前的浏览器事实。
> 基线：2026-11-05 的现行标准与 MDN 文档；目标载体是本仓现有的零构建 H5/PWA（apps/web，无打包、无上传后端）。
> 证据等级：**A** = 标准/官方文档原文（WHATWG HTML、W3C、ws 官方文档）；**B** = MDN 文档；**C** = 多方一致或可直接推导的算术/实现事实；**D** = 未取到一手来源，本仓为实现做的裁决，必须写进测试或运行时兜底。
>
> **与既有笔记的关系**：`salem-online-realtime-platform-facts.md` 只覆盖 12 人实时承载与载体选择，`salem-1692-card-and-rules-facts.md` 只覆盖卡牌结算；两篇都不涉及选图、编码、体积与本地存储配额，故另起本篇。**结论：两篇既有笔记无法回答本次问题。**

## 0. 结论

1. **不要做上传端点，做客户端重编码 + data URL 走既有 WebSocket。** 当前服务端没有任何上传路由（apps/server/src/server.mjs:555-613 只服务静态文件与 /api/rooms），而房间是 2 小时 TTL 的内存态（:29），图片没有落盘理由；加一条消息比加一套 multipart 上传 + 存储 + 清理便宜得多。
2. **WebP 编码不可假定存在。** 标准只保证 `image/png`；请求 `image/webp` 时浏览器若不支持会**静默返回 PNG**，不会抛错。必须用返回串前缀校验，失败回退 `image/jpeg`（证据 A）。
3. **选图必须自己归一化尺寸。** `createImageBitmap` 默认按 EXIF 方向解码（`imageOrientation: "from-image"`），直接在 canvas 上 256×256 居中裁切即可，不需要读 EXIF 也不需要用 CSS 旋转兜底（证据 B）。
4. **file input 走相册就不加 `capture`。** `capture` 只是「强烈建议用相机」的提示；不写它，移动浏览器给的是图库/相机/文件的选择（证据 A/B）。
5. **头像能存进 localStorage，但要当作「可能失败」写。** 每个 origin 的 local storage 约 5 MiB，超限抛 `QuotaExceededError`；压缩到 40KB 级后，一张头像是配额的 1% 量级，但用户可能已经存了别的东西（证据 B）。
6. **必须自卡消息体积。** ws 的 `maxPayload` 默认约 100 MiB（`104857600`，0 表示关闭），服务端当前没有设置它；业务层不自己卡长度等于开放内存放大（证据 A）。
7. **HEIC、iOS 主屏 PWA 的 file input 行为没有一手来源。** 只能按「可能选到 HEIC，且可能解不出来」写运行时兜底（证据 D）。

## 1. 编码：canvas 导出格式与回退

- 标准原文（WHATWG HTML，`HTMLCanvasElement.toDataURL()`）：*"The first argument, if provided, controls the type of the image to be returned (e.g. PNG or JPEG). The default is `image/png`; that type is also used if the given type isn't supported."* —— 证据 A。
- 标准同时给出作者的检查手法（同页）：*"When trying to use types other than `image/png`, authors can check if the image was really returned in the requested format by checking to see if the returned string starts with one of the exact strings `data:image/png,` or `data:image/png;`."* —— 证据 A。
- MDN 对 `toBlob()` / `OffscreenCanvas.convertToBlob()` 的说明是只有 `image/png` 强制支持，`image/jpeg`、`image/webp` 属 *"many will support"* —— 证据 B。
- 实现裁决（D）：编码优先级 `image/webp` → 探测前缀失败则 `image/jpeg`（quality 0.82）；两者都拿不到时直接用 `image/png` 并把体积上限当硬门禁（超限就降到 192 或 160 边长重试一次，仍超限则提示换一张）。
- 体积算术（证据 C，可直接推导）：data URL 的 base64 部分相对原始字节膨胀 4/3，另加 `data:image/...;base64,` 前缀约 22–30 字节。所以「解码后 ≤96KB」对应线路上约 ≤130KB 的字符串；「目标 ≤40KB」对应线路上约 ≤55KB。

## 2. 解码与方向：createImageBitmap 与 canvas

- MDN `createImageBitmap()`：`options.imageOrientation` 默认 `"from-image"`，即按图片自带的方向信息（EXIF）摆放；另有 `flipY` 与 `"none"` —— 证据 B。
- 同页确认 `resizeWidth` / `resizeHeight` / `resizeQuality` 选项存在 —— 证据 B。可用它一步完成「解码 + 按接近目标尺寸重采样」，但为了跨浏览器一致，最终仍以 canvas 的 `drawImage` 裁切为准。
- 实现裁决（D）：`createImageBitmap` 不支持或被拒（老 iOS、或被当作跨源）时，回退 `HTMLImageElement` + `object-fit: cover` 的计算式手算裁切源矩形，仍然输出 256×256。
- 实现裁决（D）：居中方形裁切取 `side = min(w, h)`，源矩形 `(w-side)/2, (h-side)/2, side, side`；不做手势缩放/拖拽（另开票）。

## 3. 选图控件：相册 vs 相机

- WHATWG HTML 对 `capture` 的定义是设备选择的提示（hint），不是开关；MDN `<input type="file">` 页面明确：`capture` 决定是否强制使用相机，未设置时由 UA 提供图库/相机/文件选择 —— 证据 A/B。
- 实现裁决（D）：`<input type="file" accept="image/*">`，**不加** `capture`；`accept` 只写 `image/*` 而不枚举 `image/heic`（枚举会让部分 UA 把相册里的 HEIC 变灰）。

## 4. HEIC / 格式兼容（证据 D，未解）

- 目标：iPhone 相册里大量是 HEIC。选到 HEIC 时，`createImageBitmap` 与 `<img>` 能否解码取决于 UA 与系统版本；**本次未取到任何一手来源**（MDN 与 WHATWG 均无 HEIC 解码义务的表述）。
- 实现裁决（D）：把「解码失败」当正常分支——`decode()` 或 `onerror` 触发时，弹层内提示「这张图片格式无法读取，试试截图后再选」，并保留重新选图按钮；不上第三方 wasm 解码器（体积与许可证都不划算）。
- 同一裁决覆盖 GIF/APNG/SVG：前两者取首帧会得到「动图变静图」的意外，SVG 作为图片嵌入时脚本是否执行缺一手引用（W3C SVG2 embedded 页只描述了 image 元素的内容模型），因此**直接拒收**这两类，用 `file.type` 白名单 +`image/svg+xml` 显式排除。

## 5. 传输：ws 体积与已有的广播形态

- ws 官方文档 `doc/ws.md`：`maxPayload` 默认 `104857600`（100 MiB），设为 0 关闭限制 —— 证据 A。本仓 `new WebSocketServer({ noServer: true })`（apps/server/src/server.mjs:621）没有设置 `maxPayload`，等于沿用 100 MiB 默认值。
- 本仓广播形态（代码事实，证据 C）：`sync()`（:170-182）每次状态变化都 `broadcast({type:"room"})` 并对每个座位单发 projection。把 12 张 40KB 头像内联进 room，单次同步就是 ~480KB 字符串 ×13 份发送，是当前实现不可接受的量级。
- 实现裁决（D）：头像单独成消息（`avatars`：连上全量、变更单推），room 只带 `avatarVersion`；服务端把头像放进内存 Map 并在房间结束时随房间一起释放。

## 6. 服务端校验清单（证据 C/D 混合）

- 前缀白名单：`data:image/webp;base64,`、`data:image/jpeg;base64,`（**不收** png，避免用户绕过压缩把 2MB PNG 塞进来）—— D。
- magic bytes：WebP `RIFF....WEBP`、JPEG `FF D8 FF` —— C（格式规范常识，逐字节校验即可）。
- 解码后字节 ≤96KB；昵称仍走现有 `safeName`（去控制字符与 `<>`、trim、空则「玩家」、`slice(0,16)`）—— C（代码事实）+ D（阈值裁决）。
- 找不到可靠一手来源给出「多大的头像对 12 人房是安全的」，所以 96KB 是**本仓裁决**：按 12 人 × 96KB ≈ 1.2MB 常驻内存估算，可接受。

## 7. 本地存储：localStorage 的边界

- MDN Storage quotas：Web Storage 整体上限约 10 MiB，其中 local storage 与 session storage **每 origin 各约 5 MiB**；达到上限时浏览器抛 `QuotaExceededError`，必须 `try/catch` —— 证据 B（页面原文："Browsers can store up to 5 MiB of local storage ... Once this limit is reached, browsers throw a QuotaExceededError exception which should be handled by using a try...catch block"）。
- 实现裁决（D）：头像 data URL 与昵称同存 localStorage（`salem.avatar` / `salem.name`）；写入失败静默降级为「本次会话无头像」，只 toast 一次；不引 IndexedDB（零构建仓库里多一个异步层不划算）。

## 8. 未解问题（需要真机验证，不是查文档能解决的）

1. iOS 主屏 PWA 里 `<input type="file">` 是否可用、是否只能走照片选择器（D）。
2. 各 UA 对 HEIC 的解码支持边界（D）。
3. WebP 编码在目标机群的覆盖率（B 已确认不可假定，但具体机型分布未知）。
4. iOS Safari 的 canvas 尺寸/内存上限与 256×256 无关，但若将来放宽到 1024 以上需重新评估（D）。

## 9. 来源

- WHATWG HTML Standard，`HTMLCanvasElement.toDataURL()` / `toBlob()` 与 `image/png` 回退、作者前缀检查：https://html.spec.whatwg.org/multipage/canvas.html
- MDN `createImageBitmap()`（`imageOrientation` 默认 `from-image`、`resizeWidth` 等选项）：https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap
- MDN `HTMLCanvasElement.toBlob()`、`OffscreenCanvas.convertToBlob()`（只有 PNG 强制支持）：https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob
- MDN `<input type="file">`（`capture` 语义、`accept`）：https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/file
- MDN Storage quotas and eviction criteria（每 origin 5 MiB、`QuotaExceededError`）：https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- ws 官方文档 `maxPayload` 默认值与语义：https://github.com/websockets/ws/blob/master/doc/ws.md
- W3C SVG2 Embedded Content（仅取到 image 元素内容模型，未取到「嵌入图片不执行脚本」的原文）：https://www.w3.org/TR/SVG2/embedded.html
