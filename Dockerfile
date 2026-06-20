FROM node:20-alpine AS dependencies

WORKDIR /app

# Copiamos solamente package.json para no usar el package-lock defectuoso
COPY package.json ./

# Forzamos el registro público oficial de npm
RUN npm config set registry https://registry.npmjs.org/ \
    && npm install --omit=dev --no-audit --no-fund \
    && node -e "require('express'); console.log('Dependencias instaladas correctamente')"

FROM node:20-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY server.js ./
COPY public ./public

RUN mkdir -p /app/data /app/uploads

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]