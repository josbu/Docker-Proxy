# ---- build stage ----
FROM node:20-alpine AS build
WORKDIR /src
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY . .

# ---- runtime stage ----
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
# 容器内端口（对外通过 docker 端口映射暴露）
ENV PORT=3000
COPY --from=build /src/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
