FROM node:20-alpine AS dependencies

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force \
    && node -e "require('express'); console.log('Dependencias instaladas correctamente')"

FROM node:20-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY server.js ./
COPY public ./public

RUN mkdir -p /app/data /app/uploads

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
