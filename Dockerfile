# 《女巫镇》在线版 —— 单镜像运行
#
# 服务端从仓库根的 apps/web 与 assets 读静态资源（server.mjs 里
# ROOT = resolve(__dirname, "../../..")），所以镜像必须保留整棵仓树，
# 只丢掉构建上下文里用不到的东西（见 .dockerignore）。
FROM node:24-slim

ENV NODE_ENV=production
WORKDIR /app

# 先只拷依赖清单，让 npm ci 这一层能长期复用缓存
COPY apps/server/package.json apps/server/package-lock.json ./apps/server/
RUN npm ci --prefix apps/server --omit=dev

COPY . .

EXPOSE 8080
CMD ["node", "apps/server/src/server.mjs"]
