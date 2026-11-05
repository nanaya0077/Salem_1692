---
id: W-03
title: 首发载体与分享 / 登录路径
type: wayfinder:grilling
status: closed
parent: MAP-1
blockedBy: []
assignee: lead
created: 2026-11-05
---

## Question

首发载体选哪一个：移动浏览器 H5 / PWA、微信内 H5、微信小程序，还是原生 / 跨端壳？分享与登录怎么做？是否要求免登录游客房？

## 建议（可被推翻）

H5 / PWA 先行：链接 + 6 位房码分享，游客昵称即开即玩；二期用 Capacitor 套壳进应用商店；微信小程序等 W-02 的数据出来后再判断是否作为第二入口。

## Answer

**结论（1A）：H5/PWA 首发，链接 + 6 位房码 + 游客昵称即开；小程序与原生壳留二期。**

- 载体：移动浏览器 H5，竖屏优先；PWA 只做“添加到主屏幕 / 全屏 / 静态离线壳”，不做应用商店首发。Capacitor 套壳二期再评估。
- 分享：`https://APP_URL/r/ROOM_CODE`，6 位码去掉 0/O/1/I；支持复制链接与二维码；微信内直接打开系统浏览器，不依赖微信登录。
- 登录：游客昵称 + 头像即可；服务端发 `seatToken`（localStorage 保存），刷新/重连回原座位；账号（Apple/Google/手机号）二期。
- 约束：HTTPS/WSS；iOS Safari 首次点击解锁音频；最小 360×640，目标 390×844 / 430×932；safe-area；无 hover；弱网 3G 可进房。
- 不做：小程序 MVP、原生 App、微信 JS-SDK 登录、跨设备进度。
- 落地：见 [SPEC.md](../SPEC.md) §1、§6。
