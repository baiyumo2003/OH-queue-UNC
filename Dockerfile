FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .
RUN chmod -R a+r public

EXPOSE 8080

CMD ["npm", "start"]
