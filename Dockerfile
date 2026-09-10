FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --fetch-retries=5 --fetch-retry-mintimeout=2000 --fetch-retry-maxtimeout=60000
COPY . .
RUN npx prisma generate && npm run build
RUN mkdir -p .next/standalone/.next && cp -r .next/static .next/standalone/.next/static && cp -r public .next/standalone/public
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV MEAL_PLAN_ROOT=/app
EXPOSE 7000
CMD ["sh", "-c", "npx prisma db push && node scripts/migrate-attendance.mjs && exec node scripts/start.mjs"]
