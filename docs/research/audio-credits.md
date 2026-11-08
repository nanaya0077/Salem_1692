# 动效音效授权与来源

首批音效全部由本仓脚本用振荡器/噪声合成，没有人声、采样包或第三方录音。
素材以 [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/) 释出，
随仓库分发，不要求署名；若二次分发，保留本文件即可。

| id | 文件 | 用途 | 规格 | 时长 |
| --- | --- | --- | --- | --- |
| `sfx.ui.tap` | `assets/audio/sfx.ui.tap.mp3` | 按钮 / 选牌 / 目标点按 | mono 22.05 kHz · 64 kbps · 峰值 −1 dBFS | ≈0.16 s |
| `sfx.card.play` | `assets/audio/sfx.card.play.mp3` | 打出一张牌 | mono 22.05 kHz · 64 kbps · 峰值 −1 dBFS | ≈0.20 s |
| `sfx.reveal.flip` | `assets/audio/sfx.reveal.flip.mp3` | 身份卡翻开 | mono 22.05 kHz · 64 kbps · 峰值 −1 dBFS | ≈0.26 s |
| `sfx.life.death` | `assets/audio/sfx.life.death.mp3` | 公开死亡 / 情侣连锁 | mono 22.05 kHz · 64 kbps · 峰值 −1 dBFS | ≈0.52 s |
| `sfx.timer.warn` | `assets/audio/sfx.timer.warn.mp3` | 回合最后 10 秒 | mono 22.05 kHz · 64 kbps · 峰值 −1 dBFS | ≈0.20 s |
| `sfx.phase.dawn` | `assets/audio/sfx.phase.dawn.mp3` | 夜晚 → 黎明 | mono 22.05 kHz · 64 kbps · 峰值 −1 dBFS | ≈1.46 s |
| `amb.night` | `assets/audio/amb.night.mp3` | 夜晚环境垫（10 s 循环） | stereo 44.1 kHz · 128 kbps · RMS ≈0.055 · true peak ≤ −2 dBTP | 10 s |

实现约束见 `docs/wayfinder/salem-online/motion` 相关票与 `apps/web/audio.js`：
音效只跟随动效三档（全开 / 减弱 / 关），首次真实手势解锁，加载失败静默降级，
不做 per-seat 播放，也不把音频放进 Service Worker 的预缓存清单。
